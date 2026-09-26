/**
 * Music player (WebAudio layer): loads sets on demand, runs decks of sample-locked stem loops and executes the
 * director's commands.
 *
 * Deck graph (one per playing set):
 *   stem source (AudioBufferSourceNode, loop = grid length) -> stem gain (adaptive mix x stem trim)
 *     -> fade-in gain -> fade-out gain -> player output
 *   stingers (intro, go, finish) -> stinger gain -> fade-out gain;  outro -> player output
 *   player output (level x volume x duck) -> master bus `music` (underwater muffle) -> master dynamics
 *   sprinkle phrase (one-shot) -> voice gain (edge fades x phrase gain) -> player output
 *   moment piece (one-shot) -> voice gain -> moment output (level x volume x menu duck only) -> master bus `music`
 *
 * Every stem of a deck is started with the same `when` on the AudioContext clock and loops over the same grid length,
 * so the stems stay sample-locked forever. Decoding happens only when the director asks for a set; at most
 * `maxCachedSets` decoded sets are kept (sets in use are never evicted). Phrases (sprinkles and moment pieces) are
 * one-shot voices with their own small decode cache; the moment output skips the moment duck that hushes the stems.
 */
import { checkDecodedLengths, loopSeconds, MUSIC_BASE, phraseGain, pickSource, stemsOf, STINGER_KINDS, type MusicPhraseDef, type MusicSetDef, type StemRole, type StingerKind } from './manifest';
import type { DirectorCommand } from './director';
import type { SprinkleCommand } from './sprinkle';
import type { StemMix } from './rules';

export interface MusicBuffers {
  stems: Partial<Record<StemRole, AudioBuffer>>;
  stingers: Partial<Record<StingerKind, AudioBuffer>>;
}

/** Loads a set's audio; the default fetches and decodes the manifest's files, the dev test sets render them. */
export type SetLoader = (set: MusicSetDef, ctx: BaseAudioContext) => Promise<MusicBuffers>;
/** Loads a phrase's audio (the dev test phrases render it). */
export type PhraseLoader = (phrase: MusicPhraseDef, ctx: BaseAudioContext) => Promise<AudioBuffer>;

/** Which output a one-shot voice plays into: the ducked music output, or the moment output. */
export type VoiceBus = 'main' | 'moment';

interface Voice {
  src: AudioBufferSourceNode;
  gain: GainNode;
  stopAt: number;
}

/**
 * Music level into the master dynamics: stems mastered to about -16 LUFS (full mix, see the owner guide) sit near
 * -28 LUFS in the game, under the ~-24 LUFS cruise mix of wind and world.
 */
export const MUSIC_LEVEL = 0.3;

interface Deck {
  id: number;
  set: MusicSetDef;
  buffers: MusicBuffers;
  stemGains: Partial<Record<StemRole, GainNode>>;
  stemLevels: Partial<Record<StemRole, number>>;
  fadeIn: GainNode;
  fadeOut: GainNode;
  stingerGain: GainNode;
  sources: AudioBufferSourceNode[];
  loopAt: number;
  /** Time the deck is stopped at (end scheduled), Infinity while it plays on. */
  stopAt: number;
  endBegins: number;
}

const canPlayType = (mime: string): boolean => {
  try {
    return typeof document !== 'undefined' && document.createElement('audio').canPlayType(mime) !== '';
  } catch {
    return false;
  }
};

async function fetchAudio(src: readonly string[], ctx: BaseAudioContext): Promise<AudioBuffer> {
  const file = pickSource(src, canPlayType) ?? src[0];
  const res = await fetch(`${import.meta.env.BASE_URL}${MUSIC_BASE}${file}`);
  if (!res.ok) {
    throw new Error(`${file}: HTTP ${res.status}`);
  }
  return ctx.decodeAudioData(await res.arrayBuffer());
}

/** Default phrase loader: fetch + decode the first playable format. */
export const fetchPhraseLoader: PhraseLoader = (phrase, ctx) => fetchAudio(phrase.src, ctx);

/** Default loader: fetch + decode each stem (first playable format), in parallel. */
export const fetchSetLoader: SetLoader = async (set, ctx) => {
  const load = (src: readonly string[]): Promise<AudioBuffer> => fetchAudio(src, ctx);
  const out: MusicBuffers = { stems: {}, stingers: {} };
  await Promise.all([
    ...stemsOf(set).map(async (r) => {
      out.stems[r] = await load(set.stems[r]!.src);
    }),
    ...STINGER_KINDS.filter((k) => set.stingers?.[k]).map(async (k) => {
      out.stingers[k] = await load(set.stingers![k]!.src);
    }),
  ]);
  return out;
};

export class MusicPlayer {
  readonly output: GainNode;
  /** Moment pieces: volume and the menu duck, not the moment duck of the stems. */
  readonly momentOutput: GainNode;
  private readonly cache = new Map<string, MusicBuffers>();
  private readonly loading = new Map<string, Promise<void>>();
  private readonly failed = new Set<string>();
  private readonly lru: string[] = [];
  private readonly decks = new Map<number, Deck>();
  private volume = 0.8;
  private duck = 0;
  private momentDuck = 0;
  private readonly phraseCache = new Map<string, AudioBuffer>();
  private readonly phraseLoading = new Map<string, Promise<void>>();
  private readonly phraseFailed = new Set<string>();
  private readonly phraseLru: string[] = [];
  private readonly voices = new Map<string, Voice>();
  /** Loader per phrase id (dev test phrases); others fetch their files. */
  readonly phraseLoaders = new Map<string, PhraseLoader>();
  readonly maxCachedPhrases = 6;
  private level = MUSIC_LEVEL;
  private paused: { at: number; offsets: Map<number, number> } | null = null;
  /** Loader per set id (dev test sets); others use `defaultLoader`. */
  readonly loaders = new Map<string, SetLoader>();

  constructor(
    readonly ctx: BaseAudioContext,
    destination: AudioNode,
    private readonly defaultLoader: SetLoader = fetchSetLoader,
    readonly maxCachedSets = 2,
  ) {
    this.output = ctx.createGain();
    this.output.gain.value = 0;
    this.output.connect(destination);
    this.momentOutput = ctx.createGain();
    this.momentOutput.gain.value = 0;
    this.momentOutput.connect(destination);
    this.applyOutput(0);
  }

  isReady(id: string): boolean {
    return this.cache.has(id);
  }

  hasFailed(id: string): boolean {
    return this.failed.has(id);
  }

  /** Decoded sets (debug). */
  get cached(): string[] {
    return [...this.cache.keys()];
  }

  get liveDecks(): number {
    return this.decks.size;
  }

  load(set: MusicSetDef): Promise<void> {
    if (this.cache.has(set.id)) {
      this.touch(set.id);
      return Promise.resolve();
    }
    const inflight = this.loading.get(set.id);
    if (inflight) {
      return inflight;
    }
    const loader = this.loaders.get(set.id) ?? this.defaultLoader;
    const p = loader(set, this.ctx)
      .then((buffers) => {
        const lengths: Partial<Record<StemRole, number>> = {};
        for (const r of stemsOf(set)) {
          lengths[r] = buffers.stems[r]?.duration;
        }
        const problems = checkDecodedLengths(set, lengths);
        if (problems.length) {
          console.warn(`[music] ${set.id}: stem lengths off the grid (${problems.join('; ')}); looping on the grid`);
        }
        this.cache.set(set.id, buffers);
        this.touch(set.id);
        this.evict();
      })
      .catch((err: unknown) => {
        this.failed.add(set.id);
        console.warn(`[music] could not load set ${set.id}`, err);
      })
      .finally(() => this.loading.delete(set.id));
    this.loading.set(set.id, p);
    return p;
  }

  isPhraseReady(id: string): boolean {
    return this.phraseCache.has(id);
  }

  hasPhraseFailed(id: string): boolean {
    return this.phraseFailed.has(id);
  }

  loadPhrase(phrase: MusicPhraseDef): Promise<void> {
    if (this.phraseCache.has(phrase.id)) {
      return Promise.resolve();
    }
    const inflight = this.phraseLoading.get(phrase.id);
    if (inflight) {
      return inflight;
    }
    const loader = this.phraseLoaders.get(phrase.id) ?? fetchPhraseLoader;
    const p = loader(phrase, this.ctx)
      .then((buf) => {
        if (Math.abs(buf.duration - phrase.durationSec) > 0.25) {
          console.warn(`[music] phrase ${phrase.id}: decoded ${buf.duration.toFixed(2)} s, manifest says ${phrase.durationSec} s`);
        }
        this.phraseCache.set(phrase.id, buf);
        this.phraseLru.push(phrase.id);
        const playing = new Set([...this.voices.values()].map((v) => v.src.buffer));
        for (let i = 0; this.phraseCache.size > this.maxCachedPhrases && i < this.phraseLru.length; ) {
          const id = this.phraseLru[i];
          if (playing.has(this.phraseCache.get(id) ?? null)) {
            i++;
            continue;
          }
          this.phraseCache.delete(id);
          this.phraseLru.splice(i, 1);
        }
      })
      .catch((err: unknown) => {
        this.phraseFailed.add(phrase.id);
        console.warn(`[music] could not load phrase ${phrase.id}`, err);
      })
      .finally(() => this.phraseLoading.delete(phrase.id));
    this.phraseLoading.set(phrase.id, p);
    return p;
  }

  /**
   * Executes a sprinkle / moment-music command. `owner` keeps the two directors' voice numbers apart; `bus` picks the
   * output.
   */
  executeOneShot(owner: string, cmd: SprinkleCommand, phrases: readonly MusicPhraseDef[], bus: VoiceBus): void {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    switch (cmd.type) {
      case 'load': {
        const phrase = phrases.find((x) => x.id === cmd.phraseId);
        if (phrase) {
          void this.loadPhrase(phrase);
        }
        break;
      }
      case 'play': {
        const phrase = phrases.find((x) => x.id === cmd.phraseId);
        const buf = this.phraseCache.get(cmd.phraseId);
        if (!phrase || !buf || this.paused) {
          break;
        }
        const t0 = Math.max(cmd.at, now);
        const t1 = t0 + Math.min(cmd.duration, buf.duration);
        const level = phraseGain(phrase);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, now);
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(level, t0 + Math.max(0.02, cmd.fadeIn));
        g.gain.setValueAtTime(level, Math.max(t0 + cmd.fadeIn, t1 - cmd.fadeOut));
        g.gain.linearRampToValueAtTime(0, t1);
        g.connect(bus === 'moment' ? this.momentOutput : this.output);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(g);
        src.start(t0);
        src.stop(t1 + 0.05);
        const key = `${owner}:${cmd.voice}`;
        src.onended = () => {
          g.disconnect();
          if (this.voices.get(key)?.src === src) {
            this.voices.delete(key);
          }
        };
        this.voices.set(key, { src, gain: g, stopAt: t1 + 0.05 });
        break;
      }
      case 'stop': {
        const v = this.voices.get(`${owner}:${cmd.voice}`);
        if (!v) {
          break;
        }
        const t0 = Math.max(cmd.at, now);
        const t1 = t0 + Math.max(0.05, cmd.fade);
        if (t1 >= v.stopAt) {
          break;
        }
        v.gain.gain.cancelScheduledValues(now);
        v.gain.gain.setValueAtTime(v.gain.gain.value, now);
        v.gain.gain.setValueAtTime(v.gain.gain.value, t0);
        v.gain.gain.linearRampToValueAtTime(0, t1);
        try {
          v.src.stop(t1 + 0.05);
        } catch {
          /* already stopped */
        }
        v.stopAt = t1 + 0.05;
        break;
      }
    }
  }

  /** Voices sounding now (debug). */
  get liveVoices(): number {
    return this.voices.size;
  }

  private touch(id: string): void {
    const i = this.lru.indexOf(id);
    if (i >= 0) {
      this.lru.splice(i, 1);
    }
    this.lru.push(id);
  }

  private evict(): void {
    const inUse = new Set([...this.decks.values()].map((d) => d.set.id));
    for (let i = 0; this.cache.size > this.maxCachedSets && i < this.lru.length; ) {
      const id = this.lru[i];
      if (inUse.has(id)) {
        i++;
        continue;
      }
      this.cache.delete(id);
      this.lru.splice(i, 1);
    }
  }

  execute(cmd: DirectorCommand, sets: readonly MusicSetDef[], mix: StemMix): void {
    switch (cmd.type) {
      case 'load': {
        const set = sets.find((s) => s.id === cmd.setId);
        if (set) {
          void this.load(set);
        }
        break;
      }
      case 'start': {
        const set = sets.find((s) => s.id === cmd.setId);
        const buffers = this.cache.get(cmd.setId);
        if (set && buffers) {
          this.startDeck(cmd.deck, set, buffers, cmd.at, cmd.loopAt, cmd.fadeIn, cmd.intro, mix);
        }
        break;
      }
      case 'end':
        this.endDeck(cmd.deck, cmd.at, cmd.duration, cmd.outro);
        break;
      case 'cancel-end': {
        const d = this.decks.get(cmd.deck);
        if (d && this.ctx.currentTime < d.endBegins) {
          d.fadeOut.gain.cancelScheduledValues(0);
          d.fadeOut.gain.setValueAtTime(1, this.ctx.currentTime);
          for (const s of d.sources) {
            try {
              s.stop(1e9);
            } catch {
              /* already stopped */
            }
          }
          d.stopAt = Infinity;
          d.endBegins = Infinity;
        }
        break;
      }
      case 'stinger': {
        const d = [...this.decks.values()].find((x) => x.set.id === cmd.setId && x.stopAt === Infinity);
        const buf = d?.buffers.stingers[cmd.kind];
        if (d && buf) {
          this.playStinger(d, cmd.kind, buf, Math.max(cmd.at, this.ctx.currentTime), d.stingerGain);
        }
        break;
      }
    }
  }

  private startDeck(id: number, set: MusicSetDef, buffers: MusicBuffers, at: number, loopAt: number, fadeIn: number, intro: boolean, mix: StemMix): void {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const t0 = Math.max(at, now);
    const loopStart = Math.max(loopAt, now);
    const fadeInNode = ctx.createGain();
    const fadeOutNode = ctx.createGain();
    const stingerGain = ctx.createGain();
    fadeInNode.gain.setValueAtTime(fadeIn > 0.06 ? 0 : 1, now);
    if (fadeIn > 0.06) {
      fadeInNode.gain.setValueAtTime(0, t0);
      fadeInNode.gain.linearRampToValueAtTime(1, t0 + fadeIn);
    }
    fadeInNode.connect(fadeOutNode).connect(this.output);
    stingerGain.gain.value = set.gain ?? 1;
    stingerGain.connect(fadeOutNode);
    const deck: Deck = { id, set, buffers, stemGains: {}, stemLevels: {}, fadeIn: fadeInNode, fadeOut: fadeOutNode, stingerGain, sources: [], loopAt: loopStart, stopAt: Infinity, endBegins: Infinity };
    const loopLen = loopSeconds(set);
    for (const role of stemsOf(set)) {
      const buf = buffers.stems[role];
      if (!buf) {
        continue;
      }
      const g = ctx.createGain();
      const level = this.stemLevel(set, role, mix[role]);
      g.gain.value = level;
      deck.stemLevels[role] = level;
      g.connect(fadeInNode);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.loopStart = 0;
      src.loopEnd = Math.min(loopLen, buf.duration);
      src.connect(g);
      src.start(loopStart);
      deck.sources.push(src);
      deck.stemGains[role] = g;
    }
    if (intro && buffers.stingers.intro) {
      this.playStinger(deck, 'intro', buffers.stingers.intro, t0, stingerGain);
    }
    this.decks.set(id, deck);
  }

  private playStinger(deck: Deck, kind: StingerKind, buf: AudioBuffer, at: number, into: AudioNode): void {
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = deck.set.stingers?.[kind]?.gain ?? 1;
    src.connect(g).connect(into);
    src.start(at);
    src.onended = () => g.disconnect();
    deck.sources.push(src);
  }

  private endDeck(id: number, at: number, duration: number, outro: boolean): void {
    const d = this.decks.get(id);
    if (!d) {
      return;
    }
    const now = this.ctx.currentTime;
    const t0 = Math.max(at, now);
    const t1 = t0 + Math.max(0.05, duration);
    d.fadeOut.gain.cancelScheduledValues(0);
    d.fadeOut.gain.setValueAtTime(1, now);
    d.fadeOut.gain.setValueAtTime(1, t0);
    d.fadeOut.gain.linearRampToValueAtTime(0, t1);
    d.endBegins = t0;
    d.stopAt = t1 + 0.05;
    if (outro && d.buffers.stingers.outro) {
      this.playStinger(d, 'outro', d.buffers.stingers.outro, t0, this.output);
    }
    for (const s of d.sources) {
      try {
        if (s.loop) {
          s.stop(d.stopAt);
        }
      } catch {
        /* not started / already stopped */
      }
    }
  }

  private stemLevel(set: MusicSetDef, role: StemRole, mix: number): number {
    return Math.max(0, mix) * (set.stems[role]?.gain ?? 1) * (set.gain ?? 1);
  }

  /**
   * Applies the smoothed adaptive mix to every live deck and releases finished decks. `momentDuck` is the duck of the
   * moment output (the menu duck, without the moment duck that hushes the stems under a moment piece).
   */
  update(mix: StemMix, duck: number, momentDuck = duck): void {
    const now = this.ctx.currentTime;
    for (const [id, d] of this.decks) {
      if (now > d.stopAt + 0.2) {
        d.fadeOut.disconnect();
        this.decks.delete(id);
        continue;
      }
      for (const role of stemsOf(d.set)) {
        const g = d.stemGains[role];
        if (!g) {
          continue;
        }
        const level = this.stemLevel(d.set, role, mix[role]);
        if (Math.abs(level - (d.stemLevels[role] ?? 0)) > 0.002) {
          d.stemLevels[role] = level;
          g.gain.setTargetAtTime(level, now, 0.08);
        }
      }
    }
    if (Math.abs(duck - this.duck) > 0.002 || Math.abs(momentDuck - this.momentDuck) > 0.002) {
      this.duck = duck;
      this.momentDuck = momentDuck;
      this.applyOutput(0.06);
    }
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
    this.applyOutput(0.05);
  }

  private applyOutput(tau: number): void {
    const base = this.paused ? 0 : this.level * this.volume * this.volume;
    const set = (node: GainNode, g: number): void => {
      if (tau <= 0) {
        node.gain.value = g;
      } else {
        node.gain.setTargetAtTime(g, this.ctx.currentTime, tau);
      }
    };
    set(this.output, base * (1 - this.duck));
    set(this.momentOutput, base * (1 - this.momentDuck));
  }

  /** Fades every one-shot voice of `owner` out (style switched, test phrases loaded). */
  stopVoices(owner: string, fade = 1): void {
    const now = this.ctx.currentTime;
    for (const key of [...this.voices.keys()]) {
      if (key.startsWith(`${owner}:`)) {
        this.executeOneShot(owner, { type: 'stop', voice: Number(key.slice(owner.length + 1)), at: now, fade }, [], 'main');
      }
    }
  }

  get isPaused(): boolean {
    return this.paused !== null;
  }

  /** Hard pause: the loops stop where they are (resume() continues from the same point). */
  pause(): void {
    if (this.paused) {
      return;
    }
    const now = this.ctx.currentTime;
    const offsets = new Map<number, number>();
    for (const d of this.decks.values()) {
      const len = loopSeconds(d.set);
      offsets.set(d.id, now >= d.loopAt ? (now - d.loopAt) % len : -(d.loopAt - now));
      for (const s of d.sources) {
        try {
          s.stop(now + 0.12);
        } catch {
          /* already stopped */
        }
      }
      d.sources = [];
    }
    this.paused = { at: now, offsets };
    this.applyOutput(0.03);
  }

  /** Resumes a hard pause; returns the paused duration (s) so the director can shift its schedule. */
  resume(): number {
    const p = this.paused;
    if (!p) {
      return 0;
    }
    this.paused = null;
    const now = this.ctx.currentTime;
    const start = now + 0.05;
    for (const d of this.decks.values()) {
      const off = p.offsets.get(d.id) ?? 0;
      const len = loopSeconds(d.set);
      d.loopAt = start - off;
      if (d.stopAt !== Infinity) {
        d.stopAt += start - p.at;
        d.endBegins += start - p.at;
      }
      for (const role of stemsOf(d.set)) {
        const buf = d.buffers.stems[role];
        const g = d.stemGains[role];
        if (!buf || !g) {
          continue;
        }
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        src.loopEnd = Math.min(len, buf.duration);
        src.connect(g);
        if (off >= 0) {
          src.start(start, off);
        } else {
          src.start(start - off);
        }
        if (d.stopAt !== Infinity) {
          src.stop(d.stopAt);
        }
        d.sources.push(src);
      }
      // Pending fade-outs are dropped by the pause: a deck that was ending ends shortly after the resume.
      if (d.stopAt !== Infinity) {
        d.fadeOut.gain.cancelScheduledValues(0);
        d.fadeOut.gain.setValueAtTime(d.fadeOut.gain.value, now);
        d.fadeOut.gain.linearRampToValueAtTime(0, Math.max(start + 0.5, d.stopAt - 0.05));
      }
    }
    this.applyOutput(0.05);
    return start - p.at;
  }

  /** Stops everything at once and forgets the decks (music switched off, set list reloaded). */
  stopAll(fade = 0.5): void {
    const now = this.ctx.currentTime;
    for (const d of this.decks.values()) {
      this.endDeck(d.id, now, fade, false);
    }
  }

  dispose(): void {
    for (const d of this.decks.values()) {
      for (const s of d.sources) {
        try {
          s.stop();
        } catch {
          /* already stopped */
        }
      }
      d.fadeOut.disconnect();
    }
    this.decks.clear();
    this.cache.clear();
    for (const v of this.voices.values()) {
      try {
        v.src.stop();
      } catch {
        /* already stopped */
      }
      v.gain.disconnect();
    }
    this.voices.clear();
    this.phraseCache.clear();
    this.output.disconnect();
    this.momentOutput.disconnect();
  }
}
