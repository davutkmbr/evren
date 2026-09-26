import type { BondAudioCue, DragonMood } from '../../../../core/contracts';
import { BehaviorScheduler, createFrame, resetFrame, type BehaviorContext, type BehaviorFrame } from './behaviors';
import { AttentionController, GazeController, SafetyGate } from './gaze';
import { MoodModel } from './mood';
import { approach, bell, BOND, BondRng, clamp, createOutputs, envelope, smooth01, smoothstep, type BondInputs, type BondOutputs } from './types';

const AIRBORNE = new Set(['flying', 'gliding', 'hovering', 'diving', 'stalling', 'landing', 'takeoff']);

/** Turkish captions of the dragon's answer to V (player-facing, shown briefly like a maneuver caption). */
export const ENCOURAGE_CAPTIONS: Record<DragonMood, string> = {
  tired: 'Evren yorgun ama seni duydu',
  content: 'Evren memnun',
  curious: 'Evren merakla sana baktı',
  playful: 'Evren oyuna hazır',
  excited: 'Evren coştu!',
};

interface Answer {
  mood: DragonMood;
  sec: number;
  duration: number;
  cue: number;
  airborne: boolean;
}

interface AnswerCue {
  at: number;
  sound?: BondAudioCue;
  volume?: number;
  flap?: boolean;
}

/** The dragon's answer to the rider's pat and call, by mood (seconds after the answer starts). */
const ANSWERS: Record<DragonMood, { duration: number; cues: AnswerCue[] }> = {
  tired: { duration: 2, cues: [{ at: 0.15, sound: 'grumble', volume: 0.8 }] },
  content: { duration: 1.4, cues: [{ at: 0.1, sound: 'chirp', volume: 0.85 }] },
  curious: { duration: 1.6, cues: [{ at: 0.1, sound: 'trill', volume: 0.8 }] },
  playful: {
    duration: 1.8,
    cues: [
      { at: 0.1, sound: 'chirp', volume: 0.8 },
      { at: 0.45, sound: 'chirp', volume: 0.9 },
    ],
  },
  excited: {
    duration: 2.2,
    cues: [
      { at: 0.05, flap: true },
      { at: 0.55, sound: 'roar-short', volume: 0.9 },
    ],
  },
};

/**
 * Phase 06 bond core: mood, gaze, glances at the world, petting reactions, the V answer, eyes, breath steam and the
 * self-driven behaviours, combined into one set of pose offsets and one-shots per frame. Pure and deterministic
 * (seeded), so the headless check drives exactly this.
 */
export class BondCore {
  readonly rng: BondRng;
  readonly safety = new SafetyGate();
  readonly gaze: GazeController;
  readonly attention: AttentionController;
  readonly mood = new MoodModel();
  readonly behaviors: BehaviorScheduler;
  readonly out: BondOutputs = createOutputs();
  private readonly answerFrame: BehaviorFrame = createFrame();
  private time = 0;
  private prevMode = '';
  private swimEndedAt = -99;
  private blinkIn = 3;
  private blinkT = -1;
  private blinkLen: number = BOND.eyes.blinkTime;
  private doubleBlink = false;
  private slowBlinkDone = false;
  private lid = 0;
  private pupil = 0.3;
  private light = 1;
  private plates = 0;
  private breathPhase = 0;
  private petTime = 0;
  private purrIn = 0.4;
  private purrAge = 99;
  private laughedThisPet = false;
  private laugh = 0;
  private laughTimer = 0;
  private answer: Answer | null = null;
  private encourageAt = -99;
  private patT = 99;
  private calm = 0;
  private tailCurl = 0;

  constructor(seed = 0x5eed) {
    this.rng = new BondRng(seed);
    this.gaze = new GazeController(this.rng);
    this.attention = new AttentionController(this.rng);
    this.behaviors = new BehaviorScheduler(this.rng);
    this.blinkIn = this.rng.range(1, 4);
  }

  update(inp: BondInputs): BondOutputs {
    const dt = Math.max(0, Math.min(inp.dt, 0.25));
    const out = this.out;
    out.sounds.length = 0;
    out.puffs.length = 0;
    out.captions.length = 0;
    if (dt <= 0) {
      return out;
    }
    this.time += dt;
    const safety = this.safety.evaluate(inp);
    this.events(inp);
    this.mood.update(inp);
    const mood = this.mood.mood;
    const d = this.mood.drives;

    // --- Encourage (V): the rider's pat, then the dragon's answer by mood ---
    if (inp.encourage && this.time - this.encourageAt >= BOND.encourage.cooldown) {
      this.encourageAt = this.time;
      this.patT = 0;
      this.answer = { mood, sec: -BOND.encourage.reactDelay, duration: ANSWERS[mood].duration, cue: 0, airborne: AIRBORNE.has(inp.mode) };
      this.mood.kick('affection', 0.05);
      this.mood.kick('excitement', mood === 'excited' || mood === 'playful' ? 0.08 : 0.03);
      out.captions.push(ENCOURAGE_CAPTIONS[mood]);
      if (mood === 'content' || mood === 'curious') {
        this.gaze.queue(0.25, 1.3, 0.75, 2);
      }
    }
    this.patT += dt;
    const patting = this.patT < BOND.encourage.patTime ? envelope(this.patT / BOND.encourage.patTime, 0.25, 0.3) : 0;
    this.updateAnswer(inp, dt);

    // --- Gaze and glances at the world ---
    this.gaze.update(inp, safety, mood);
    const petting = inp.petActive ? inp.petting : 0;
    const behaviorAllowed = safety.behaviorOk && petting < 0.05 && !this.answer && !this.gaze.busy && !inp.riderStanding;
    this.attention.update(inp, safety, this.gaze.level > 0.1 || this.behaviors.weight > 0.05);
    // Every new sight feeds curiosity (a bird a little, a stork kettle or a ferry more).
    const seen = this.attention.started;
    if (seen && seen !== 'landmark') {
      this.mood.kick('curiosity', seen === 'bird' ? 0.04 : 0.12);
    }

    // --- Self-driven behaviours ---
    const bird = this.closestBird(inp);
    const ctx: BehaviorContext = {
      inp,
      mood,
      fatigue: d.fatigue,
      calmAir: AIRBORNE.has(inp.mode) && !safety.critical && (inp.mode === 'gliding' || inp.mode === 'flying' || inp.mode === 'hovering'),
      resting: inp.perched || (inp.mode === 'grounded' && inp.groundSpeed < 1) || (inp.mode === 'swimming' && inp.groundSpeed < 1.5),
      grounded: inp.mode === 'grounded',
      swimming: inp.mode === 'swimming',
      bird,
    };
    this.behaviors.update(ctx, behaviorAllowed);
    const b = this.behaviors.frame;
    for (const cue of this.behaviors.cues) {
      if (cue.sound) {
        out.sounds.push({ cue: cue.sound, volume: cue.volume ?? 1 });
      }
      if (cue.puff) {
        out.puffs.push({ kind: cue.puff, strength: cue.strength ?? 1 });
      }
    }

    // --- Petting reaction: purr, half-closed eyes, plates up, tail tip curling, a light rumble ---
    this.petTime = petting > 0.5 ? this.petTime + dt : 0;
    this.purrAge += dt;
    if (petting > 0.6) {
      this.purrIn -= dt;
      if (this.purrIn <= 0) {
        const deep = d.affection > 0.7;
        out.sounds.push(deep ? { cue: 'purr-deep', volume: 0.75 + 0.35 * d.affection } : { cue: 'purr', volume: 0.7 + 0.3 * d.affection });
        this.purrIn = BOND.pet.purrEvery + this.rng.range(0, 0.4);
        this.purrAge = 0;
      }
      if (this.petTime > 5 && !this.laughedThisPet) {
        this.laughedThisPet = true;
        this.laughTimer = 1.1;
      }
    } else {
      this.purrIn = 0.5;
      if (petting < 0.05) {
        this.laughedThisPet = false;
      }
    }
    const purring = this.purrAge < 2.1 ? Math.sin((Math.PI * this.purrAge) / 2.1) : 0;
    out.rumble = petting > 0.6 ? BOND.pet.rumble * (0.5 + 0.5 * purring) * petting : 0;

    // --- Calm weight for the mood flavour (nothing while critical) ---
    this.calm = approach(this.calm, safety.critical ? 0 : 1, safety.critical ? 6 : 1, dt);
    const lv = this.mood.level * this.calm;
    const a = this.answerFrame;

    // --- Combine ---
    const att = this.attention;
    const neckFree = 1 - Math.min(1, this.behaviors.weight);
    out.gazeRider = this.gaze.level;
    out.gazeSide = this.gaze.side;
    out.neckYaw = att.yaw * att.weight * neckFree + b.neckYaw + a.neckYaw;
    out.neckPitch =
      att.pitch * att.weight * 0.7 * neckFree +
      b.neckPitch +
      a.neckPitch +
      lv * (mood === 'tired' ? -0.07 : mood === 'curious' ? 0.05 : mood === 'excited' ? 0.06 : 0);
    out.neckShake = b.neckShake + a.neckShake;
    out.headRoll =
      b.headRoll + a.headRoll + lv * (mood === 'curious' ? 0.12 * Math.sin(this.time * 0.45) : mood === 'playful' ? 0.06 * Math.sin(this.time * 0.8) : 0) + 0.1 * this.gaze.side * this.gaze.level * smooth01(petting);
    out.jawMin = Math.max(b.jaw, a.jaw);
    out.bodyRoll = b.bodyRoll + a.bodyRoll;
    out.tailYaw = b.tailYaw + a.tailYaw + lv * (mood === 'playful' ? 0.1 * Math.sin(this.time * 1.7) : mood === 'excited' ? 0.06 * Math.sin(this.time * 2.3) : 0);
    out.tailPitch = b.tailPitch + a.tailPitch + lv * (mood === 'tired' ? 0.08 : mood === 'excited' ? -0.05 : 0);
    // The tail tip curls up slowly while petted (and while dozing).
    const curlTarget = Math.max(petting * smoothstep(0.5, 3.5, this.petTime), b.tailCurl);
    this.tailCurl = approach(this.tailCurl, curlTarget, curlTarget > this.tailCurl ? 0.6 : 1.2, dt);
    out.tailCurl = this.tailCurl;
    out.wingWeight = Math.max(b.wingWeight, a.wingWeight);
    out.wingSpread = b.wingWeight >= a.wingWeight ? b.wingSpread : a.wingSpread;
    out.wingRaise = Math.max(b.wingRaise, a.wingRaise);
    out.beatWeight = Math.max(a.beatWeight, b.beatWeight);
    out.beatPhase = a.beatWeight >= b.beatWeight ? a.beatPhase : b.beatPhase;

    // Neck plates: up while petted (after the first strokes), a little when excited or content.
    const platesTarget = Math.max(
      petting * smoothstep(0.4, 1.4, this.petTime) * BOND.pet.plates,
      b.plates,
      a.plates,
      lv * (mood === 'excited' ? 0.4 : mood === 'content' ? 0.12 : mood === 'playful' ? 0.2 : 0),
    );
    this.plates = approach(this.plates, platesTarget, platesTarget > this.plates ? 1.6 : 0.8, dt);
    out.neckPlates = this.plates;

    this.updateEyes(inp, dt, petting, b.eyeLid, a.eyeLid);
    this.updateBreath(inp, dt);

    // --- Rider cues ---
    this.laughTimer = Math.max(0, this.laughTimer - dt);
    const laughTarget = Math.max(b.laugh, a.laugh, this.laughTimer > 0 ? 1 : 0);
    this.laugh = approach(this.laugh, laughTarget, 6, dt);
    out.riderLaugh = this.laugh;
    out.riderShow = att.show * (1 - petting);
    out.riderShowYaw = att.yaw;
    out.riderShowPitch = att.pitch;
    out.riderPat = patting;
    out.mood = mood;
    out.moodLevel = this.mood.level;
    out.behavior = this.behaviors.current;
    this.sanitize();
    return out;
  }

  /** Mode transitions and one-shot events: landing after a long flight, leaving the water, discoveries, tricks. */
  private events(inp: BondInputs): void {
    const prev = this.prevMode;
    const mode = inp.mode;
    if (prev !== mode) {
      if (prev === 'swimming' && mode !== 'underwater') {
        this.swimEndedAt = this.time;
        this.behaviors.trigger('shake-off', 10);
      }
      if (mode === 'grounded' && AIRBORNE.has(prev) && (this.mood.flightTime > BOND.behavior.stretchAfterFlight || this.mood.drives.fatigue > 0.55)) {
        this.behaviors.trigger('wing-stretch', 12);
      }
      this.prevMode = mode;
    }
    if (inp.discovery) {
      this.mood.kick('curiosity', 0.35);
      this.mood.kick('excitement', 0.3);
    }
    if (inp.trickDone) {
      this.mood.kick('excitement', 0.12);
      this.mood.kick('playfulness', 0.04);
    }
  }

  private closestBird(inp: BondInputs): BehaviorContext['bird'] {
    let best: BehaviorContext['bird'] = null;
    for (const c of inp.attention) {
      if (c.kind === 'bird' && (!best || c.distance < best.distance)) {
        best = { yaw: c.yaw, pitch: c.pitch, distance: c.distance };
      }
    }
    return best;
  }

  private updateAnswer(inp: BondInputs, dt: number): void {
    const f = this.answerFrame;
    resetFrame(f);
    const ans = this.answer;
    if (!ans) {
      return;
    }
    ans.sec += dt;
    if (ans.sec < 0) {
      return;
    }
    const spec = ANSWERS[ans.mood];
    while (ans.cue < spec.cues.length && spec.cues[ans.cue].at <= ans.sec / spec.duration) {
      const c = spec.cues[ans.cue++];
      if (c.sound) {
        this.out.sounds.push({ cue: c.sound, volume: c.volume ?? 1 });
      }
      if (c.flap && ans.airborne) {
        this.out.sounds.push({ cue: 'flap', volume: 0.8 });
      }
    }
    const t = Math.min(1, ans.sec / spec.duration);
    const e = envelope(t, 0.2, 0.3);
    switch (ans.mood) {
      case 'tired':
        // A slow nod: down, up, and heavy lids.
        f.neckPitch = -0.25 * Math.sin(Math.PI * t) * (1 - 0.4 * bell(t, 0.7, 0.2));
        f.eyeLid = 0.5 * e;
        break;
      case 'content':
        f.headRoll = 0.22 * e;
        f.plates = 0.4 * e;
        break;
      case 'curious':
        f.headRoll = 0.3 * Math.sin(Math.PI * t);
        f.neckPitch = 0.08 * e;
        break;
      case 'playful':
        f.headRoll = 0.2 * Math.sin(2 * Math.PI * t) * e;
        f.bodyRoll = 0.1 * Math.sin(2 * Math.PI * 1.5 * t) * e;
        f.tailYaw = 0.3 * Math.sin(2 * Math.PI * 1.5 * t) * e;
        f.laugh = bell(t, 0.5, 0.3) * 0.6;
        break;
      case 'excited': {
        // One joyful wing beat (visual, only while gliding; on the ground the wings shiver up) and a short roar.
        const beat = ans.airborne ? bell(t, 0.22, 0.2) : 0;
        f.beatWeight = beat;
        f.beatPhase = smoothstep(0.02, 0.42, t) * Math.PI * 2;
        if (!ans.airborne) {
          f.wingWeight = 0.7 * bell(t, 0.25, 0.22);
          f.wingSpread = 0.55;
          f.wingRaise = 0.6 * bell(t, 0.25, 0.22);
        }
        f.jaw = 0.85 * bell(t, 0.66, 0.2);
        f.neckPitch = 0.2 * bell(t, 0.66, 0.25);
        f.plates = e;
        f.laugh = bell(t, 0.75, 0.25);
        break;
      }
    }
    if (ans.sec >= spec.duration) {
      this.answer = null;
    }
  }

  /** Blinks (slower when tired), a slow blink on eye contact, half-closed while petted; pupils follow the light. */
  private updateEyes(inp: BondInputs, dt: number, petting: number, behaviorLid: number, answerLid: number): void {
    const e = BOND.eyes;
    const d = this.mood.drives;
    // Blink timing.
    if (this.blinkT < 0) {
      this.blinkIn -= dt;
      if (this.blinkIn <= 0) {
        this.blinkT = 0;
        this.blinkLen = d.fatigue > 0.5 ? e.tiredBlinkTime : e.blinkTime;
        this.doubleBlink = this.rng.next() < e.doubleBlink;
      }
    } else {
      this.blinkT += dt;
      if (this.blinkT >= this.blinkLen) {
        this.blinkT = -1;
        this.blinkIn = this.doubleBlink ? 0.12 : this.rng.range(e.blinkEvery[0], e.blinkEvery[1]) * (1 + 0.6 * d.fatigue);
        this.doubleBlink = false;
      }
    }
    // Eye contact: one slow blink ("I trust you") once the head has come round.
    if (this.gaze.level > 0.7 && !this.slowBlinkDone && this.blinkT < 0) {
      this.slowBlinkDone = true;
      this.blinkT = 0;
      this.blinkLen = 0.55;
    } else if (this.gaze.level < 0.2) {
      this.slowBlinkDone = false;
    }
    const blink = this.blinkT >= 0 ? Math.sin(Math.PI * (this.blinkT / this.blinkLen)) : 0;
    const pet = petting * (BOND.pet.lid + (BOND.pet.lidDeep - BOND.pet.lid) * smoothstep(3, 6, this.petTime));
    const base = Math.max(0.28 * d.fatigue * this.calm, pet, behaviorLid, answerLid);
    this.lid = approach(this.lid, base, 8, dt);
    this.out.eyeLid = clamp(Math.max(this.lid, blink), 0, 1);
    // Pupils: light first (slow), then mood (quicker); a little wider while petted.
    this.light = approach(this.light, clamp(inp.light, 0, 1), 1.2, dt);
    const moodWide = 0.2 * d.excitement + 0.1 * d.curiosity + 0.08 * petting;
    this.pupil = approach(this.pupil, clamp(0.1 + 0.72 * (1 - this.light) + moodWide, 0, 1), 3, dt);
    this.out.pupil = this.pupil;
  }

  /** Breath cycle and the visible nostril steam in cold or humid air. */
  private updateBreath(inp: BondInputs, dt: number): void {
    const s = BOND.steam;
    const exertion = clamp((1 - inp.stamina) * 0.7 + inp.flapEffort * 0.6, 0, 1);
    const period = s.breathRest + (s.breathHard - s.breathRest) * exertion;
    this.breathPhase = (this.breathPhase + dt / period) % 1;
    const exhale = Math.max(0, Math.sin(2 * Math.PI * this.breathPhase));
    this.out.exhale = Math.pow(exhale, 1.5);
    const t = inp.airTempC;
    const cold = smoothstep(s.mild, s.cold, t);
    const humid = smoothstep(0.75, 0.95, inp.humidity + 0.2 * inp.rain) * smoothstep(s.humidMild, s.cold, t) * 0.7;
    const hidden = inp.firing || inp.mode === 'underwater';
    this.out.nostrilSteam = hidden ? 0 : clamp(Math.max(cold, humid) * (0.6 + 0.4 * exertion), 0, 1);
  }

  /** No NaN ever reaches the rig. */
  private sanitize(): void {
    const o = this.out as unknown as Record<string, unknown>;
    for (const k in o) {
      const v = o[k];
      if (typeof v === 'number' && !Number.isFinite(v)) {
        o[k] = 0;
      }
    }
  }
}
