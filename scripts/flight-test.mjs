#!/usr/bin/env node
/**
 * Scripted flight manoeuvres on the running app (headless Chrome, real GPU), measured with the
 * deterministic fixed-step fast-forward in window.__flightTest.simulate().
 *
 *   node scripts/flight-test.mjs                              # full app at ?view=bogaz, all manoeuvres
 *   node scripts/flight-test.mjs --only cruise,glide,dive     # subset
 *   node scripts/flight-test.mjs --url "/sandbox/flight.html?lite=1&view=bogaz"
 *   node scripts/flight-test.mjs --json                       # raw JSON only
 *   node scripts/flight-test.mjs --shots .shots/flight        # also real-time third-person screenshots
 *   node scripts/flight-test.mjs --only roll --shots .shots/flight --shotonly wheld,rudder
 *
 * Target envelope: cruise 25-45 m/s, glide ratio 8-12, stall 13-16 m/s (CLmax ~1.5 @ 18-20°),
 * folded dive 80-90 m/s, 60° bank turn at ~2 g, soft landing (< 3 m/s), water skim with splashes.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const BASE = opt('base', 'http://127.0.0.1:5199');
const URL_PATH = opt('url', '/?view=bogaz&nohud=1');
const ONLY = opt('only', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const JSON_ONLY = args.includes('--json');
const SHOTS = opt('shots', '');
const SHOT_ONLY = opt('shotonly', '')
  .split(',')
  .map((x) => x.trim())
  .filter(Boolean);

/* ------------------------------------------------------------------------------------------------ */
/* In-page manoeuvres. Each runs inside the page (no closures) and returns a plain result object.    */
/* ------------------------------------------------------------------------------------------------ */

const PREAMBLE = `
  const T = window.__flightTest;
  const DEG = Math.PI / 180;
  const calm = () => T.options({ wind: false, turbulence: false, thermals: false, autoFlap: true, stallProtection: true });
  const water = () => T.findSpot('water', T.sim.body.position.x, T.sim.body.position.z, 6000) || { x: 0, y: 0, z: 0 };
  const mean = (a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
  const r1 = (v) => Math.round(v * 10) / 10;
  const r2 = (v) => Math.round(v * 100) / 100;
  const rho = (y) => 1.225 * Math.exp(-Math.max(y, 0) / 8500);
  T.input(null);
  T.wind(null);
  T.setStamina(1);
  // Lowest wingtip at the bottom of the downstroke (flat-surface estimate).
  const tipNow = () => T.wingtipClearance();
  // Heading unwrapping for yaw-change measurements.
  const unwrap = (prev, y) => prev + Math.atan2(Math.sin(y - prev), Math.cos(y - prev));
`;

const MANEUVERS = {
  cruise: `
    calm();
    const w = water();
    T.teleport(w.x, 450, w.z, 20, 0, 32);
    T.simulate(12);
    const s0 = T.state();
    const run = T.simulate(40, null, 0.25);
    const s1 = run.final;
    const speeds = run.samples.map((s) => s.airspeed);
    const gliding = run.samples.filter((s) => s.mode === 'gliding').length / run.samples.length;
    return {
      airspeedMean: r1(mean(speeds)), airspeedMin: r1(Math.min(...speeds)), airspeedMax: r1(Math.max(...speeds)),
      altitudeChange: r1(s1.y - s0.y), effortMean: r2(mean(run.samples.map((s) => s.effort))),
      beatsPerSecond: r2(run.events.flap / 40), glideFraction: r2(gliding),
      pitchDegMean: r1(mean(run.samples.map((s) => s.pitchDeg))), alphaDegMean: r1(mean(run.samples.map((s) => s.alphaDeg))),
      spreadMean: r2(mean(run.samples.map((s) => s.spread))), staminaDelta: r2(s1.stamina - s0.stamina),
    };
  `,
  climb: `
    calm();
    const w = water();
    T.teleport(w.x, 300, w.z, 20, 0, 30);
    T.simulate(6);
    const s0 = T.state();
    const run = T.simulate(20, (t, sim, cmd, ov) => { cmd.flap = true; ov.airspeedTarget = 26; }, 0.25);
    const late = run.samples.filter((s) => s.time - s0.time > 6);
    const climb = (late[late.length - 1].y - late[0].y) / (late[late.length - 1].time - late[0].time);
    return {
      climbRate: r2(climb), airspeed: r1(mean(late.map((s) => s.airspeed))), gammaDeg: r1(mean(late.map((s) => s.gammaDeg))),
      beatHz: r2(mean(late.map((s) => s.frequency))), staminaPerSec: r2((run.final.stamina - s0.stamina) / 20),
      maxLevelSpeed: (() => {
        T.teleport(w.x, 500, w.z, 20, 0, 40);
        const r = T.simulate(45, (t, sim, cmd, ov) => { cmd.flap = true; ov.pathTarget = 0; T.setStamina(1); }, 1);
        return r1(r.final.airspeed);
      })(),
    };
  `,
  glide: `
    const out = {};
    let best = { gr: 0 };
    for (const v of [17, 19, 21, 23, 26, 30, 35]) {
      calm();
      T.options({ autoFlap: false });
      const w = water();
      T.teleport(w.x, 1500, w.z, 20, -4, v);
      T.simulate(14, (t, sim, cmd, ov) => { ov.airspeedTarget = v; });
      const a = T.state();
      T.simulate(25, (t, sim, cmd, ov) => { ov.airspeedTarget = v; });
      const b = T.state();
      const dist = Math.hypot(b.x - a.x, b.z - a.z);
      const gr = dist / Math.max(1e-3, a.y - b.y);
      out['v' + v] = { glideRatio: r2(gr), sink: r2((a.y - b.y) / 25), airspeed: r1(b.airspeed), alphaDeg: r1(b.alphaDeg) };
      if (gr > best.gr) best = { gr: r2(gr), speed: v };
    }
    T.options({ autoFlap: true });
    return { best, table: out };
  `,
  stall: `
    calm();
    T.options({ autoFlap: false });
    const w = water();
    T.teleport(w.x, 800, w.z, 20, 0, 28);
    T.simulate(2, (t, sim, cmd, ov) => { ov.pathTarget = 0; });
    let stallSpeed = null, stallAlpha = null, clMax = 0, alphaAtClMax = 0;
    T.simulate(30, (t, sim, cmd, ov) => {
      ov.pathTarget = 0;
      const V = sim.airspeed;
      const cl = sim.lift / (0.5 * rho(sim.body.position.y) * V * V * sim.wing.area);
      if (cl > clMax && V > 5) { clMax = cl; alphaAtClMax = (sim.alpha + 2 * DEG) / DEG; }
      if (stallSpeed === null && sim.body.velocity.y < -1.5) { stallSpeed = V; stallAlpha = (sim.alpha + 2 * DEG) / DEG; }
    });
    // Unprotected stall break: pull hard with no flapping.
    T.options({ stallProtection: false });
    T.teleport(w.x, 800, w.z, 20, 0, 22);
    let breakSpeed = null, breakAlpha = null, minAttach = 1, altLoss = 0, recovered = null;
    const y0 = T.state().y;
    T.simulate(20, (t, sim, cmd, ov) => {
      cmd.pitch = t < 5 ? -0.6 : 0;
      sim.options.autoFlap = t > 5;
      if (breakSpeed === null && sim.attachment < 0.6) { breakSpeed = sim.airspeed; breakAlpha = (sim.alpha + 2 * DEG) / DEG; }
      minAttach = Math.min(minAttach, sim.attachment);
      altLoss = Math.max(altLoss, y0 - sim.body.position.y);
      if (breakSpeed !== null && recovered === null && t > 5 && sim.attachment > 0.95 && Math.abs(sim.gamma) < 0.1) recovered = t;
    });
    T.options({ stallProtection: true, autoFlap: true });
    return {
      protectedStallSpeed: r1(stallSpeed), alphaAtStallDeg: r1(stallAlpha), clMax: r2(clMax), alphaAtClMaxDeg: r1(alphaAtClMax),
      unprotected: { breakSpeed: breakSpeed && r1(breakSpeed), breakAlphaDeg: breakAlpha && r1(breakAlpha), minAttachment: r2(minAttach), altitudeLoss: r1(altLoss), recoveredAt: recovered && r1(recovered) },
    };
  `,
  dive: `
    // Pilot inputs only: Shift held hands-off from 3000 m, then released for the pull-out.
    calm();
    const w = water();
    T.teleport(w.x, 3000, w.z, 20, 0, 35);
    T.simulate(3);
    let maxV = 0, maxLow = 0, t80 = null, minPitch = 0, maxBank = 0, paths = [];
    T.simulate(60, (t, sim, cmd) => {
      cmd.dive = true;
      if (sim.airspeed > maxV) maxV = sim.airspeed;
      if (sim.body.position.y < 1000 && sim.airspeed > maxLow) maxLow = sim.airspeed;
      if (t80 === null && sim.airspeed >= 80) t80 = t;
      minPitch = Math.min(minPitch, sim.pitch / DEG);
      maxBank = Math.max(maxBank, Math.abs(sim.bank) / DEG);
      if (t > 6) paths.push(sim.gamma / DEG);
    }, 0.5, (sim) => sim.body.position.y < 600);
    const s = T.state();
    let maxG = 0, minAlt = 1e9;
    const y0 = s.y;
    T.simulate(15, (t, sim) => {
      maxG = Math.max(maxG, sim.loadFactor);
      minAlt = Math.min(minAlt, sim.body.position.y);
    });
    const e = T.state();
    // Hands-off dive toward the sea from 900 m: the proximity floor must pull out on its own.
    T.teleport(w.x, 900, w.z, 20, 0, 40);
    let minClear = 1e9, swam = false;
    const low = T.simulate(40, (t, sim, cmd) => { cmd.dive = true; minClear = Math.min(minClear, sim.footClearance); swam = swam || sim.mode === 'swimming'; });
    return {
      maxAirspeed: r1(maxV), maxAirspeedBelow1000m: r1(maxLow), secondsTo80: t80 && r1(t80), meanPathDeg: r1(mean(paths)), minPitchDeg: r1(minPitch), maxAbsBankDeg: r1(maxBank), spreadInDive: s.spread,
      pullOut: { maxLoadFactor: r2(maxG), altitudeLost: r1(y0 - minAlt), speedAfter: r1(e.airspeed), altitudeGainedFromBottom: r1(e.y - minAlt) },
      lowDive: { minFootClearance: r1(minClear), enteredWater: swam, impacts: low.events.impact, finalMode: low.final.mode },
    };
  `,
  turn60: `
    calm();
    const w = water();
    T.teleport(w.x, 600, w.z, 20, 0, 32);
    T.simulate(8, (t, sim, cmd, ov) => { ov.bankTarget = 60 * DEG; ov.pathTarget = 0; });
    const a = T.state();
    const run = T.simulate(20, (t, sim, cmd, ov) => { ov.bankTarget = 60 * DEG; ov.pathTarget = 0; }, 0.25);
    const b = run.final;
    let dh = b.headingDeg - a.headingDeg;
    const turns = run.samples;
    let total = 0;
    for (let i = 1; i < turns.length; i++) { let d = turns[i].headingDeg - turns[i - 1].headingDeg; d = ((d + 540) % 360) - 180; total += d; }
    const rate = total / 20;
    const V = mean(turns.map((s) => s.groundSpeed));
    return {
      turnRateDegPerSec: r1(rate), radius: Math.round(V / Math.abs(rate * DEG)), bankDeg: r1(mean(turns.map((s) => s.bankDeg))),
      loadFactor: r2(mean(turns.map((s) => s.loadFactor))), airspeed: r1(mean(turns.map((s) => s.airspeed))), altitudeChange: r1(b.y - a.y),
      sideslipDeg: r1(mean(turns.map((s) => Math.abs(s.betaDeg)))), effort: r2(mean(turns.map((s) => s.effort))), theoreticalRate: r1(9.81 * Math.tan(60 * DEG) / V / DEG),
    };
  `,
  roll: `
    calm();
    const w = water();
    T.teleport(w.x, 600, w.z, 20, 0, 32);
    T.simulate(3);
    let maxRate = 0, t60 = null;
    T.simulate(2.5, (t, sim, cmd) => {
      cmd.roll = 1;
      maxRate = Math.max(maxRate, Math.abs(sim.body.angularVelocity.z) / DEG);
      if (t60 === null && sim.bank > 60 * DEG) t60 = t;
    });
    const held = T.state();
    const run = T.simulate(6, null, 0.5);
    return { maxRollRateDegPerSec: r1(maxRate), secondsTo60: t60 && r2(t60), bankHeldDeg: held.bankDeg, bankAfterRelease6s: run.final.bankDeg };
  `,
  hover: `
    calm();
    const w = water();
    T.teleport(w.x, 220, w.z, 20, 0, 28);
    let tHover = null;
    T.simulate(10, (t, sim, cmd) => { cmd.brake = true; if (tHover === null && sim.mode === 'hovering') tHover = t; });
    const a = T.state();
    const run = T.simulate(12, (t, sim, cmd) => { cmd.brake = true; }, 0.25);
    const b = run.final;
    const climb = T.simulate(4, (t, sim, cmd) => { cmd.brake = true; cmd.flap = true; });
    return {
      secondsToHover: tHover && r1(tHover), mode: b.mode, altitudeDrift: r2(b.y - a.y), groundSpeed: r2(b.groundSpeed),
      pitchDeg: r1(mean(run.samples.map((s) => s.pitchDeg))), effort: r2(mean(run.samples.map((s) => s.effort))),
      staminaPerSec: r2((b.stamina - a.stamina) / 12), enduranceSec: Math.round(1 / Math.max(1e-4, (a.stamina - b.stamina) / 12)),
      climbWithSpace: r2((climb.final.y - b.y) / 4),
    };
  `,
  landing: `
    calm();
    const p0 = T.sim.body.position;
    const spot = T.findSpot('land', p0.x, p0.z, 9000, 320);
    if (!spot) return { error: 'no flat land found' };
    T.teleport(spot.x - 260, spot.y + 70, spot.z, 90, 0, 28);
    let tLand = null, vy = null, maxFlare = 0, touchGs = 0, prevVy = 0;
    T.simulate(70, (t, sim, cmd) => {
      cmd.landPressed = t < 0.004;
      if (sim.mode === 'landing') maxFlare = Math.max(maxFlare, sim.pitch / DEG);
      if (vy === null && sim.mode === 'landing' && sim.footClearance < 0.05) { vy = prevVy; touchGs = Math.hypot(sim.body.velocity.x, sim.body.velocity.z); }
      if (tLand === null && sim.mode === 'grounded') tLand = t;
      prevVy = sim.body.velocity.y;
    });
    const g = T.state();
    // Walk, run, turn, then take off again.
    const walk = T.simulate(5, (t, sim, cmd) => { cmd.pitch = 1; });
    const run = T.simulate(5, (t, sim, cmd) => { cmd.pitch = 1; cmd.dive = true; });
    const h0 = T.state().headingDeg;
    const turn = T.simulate(2, (t, sim, cmd) => { cmd.roll = 1; });
    let dh = turn.final.headingDeg - h0; dh = ((dh + 540) % 360) - 180;
    const y0 = T.state().y;
    let tFly = null;
    const to = T.simulate(10, (t, sim, cmd) => { cmd.flapPressed = t < 0.004; if (tFly === null && sim.mode === 'flying') tFly = t; });
    return {
      spot: { x: Math.round(spot.x), z: Math.round(spot.z) }, landed: tLand !== null, secondsToLand: tLand && r1(tLand), touchdownSink: r2(-(vy ?? 0)), groundSpeedAtTouchdown: r1(touchGs), maxFlarePitchDeg: r1(maxFlare), modeAfter: g.mode,
      staminaAfter: g.stamina, walkSpeed: walk.final.groundSpeed, runSpeed: run.final.groundSpeed, turnRateDegPerSec: r1(dh / 2),
      takeoff: { secondsToFlying: tFly && r1(tFly), altitudeGain10s: r1(to.final.y - y0), speedAfter10s: to.final.airspeed, mode: to.final.mode },
    };
  `,
  skim: `
    calm();
    const w = water();
    const stand = T.sim.standHeight;
    T.teleport(w.x, T.sim.contacts.bellyDepth + 2.5, w.z, 20, 0, 30);
    let touching = 0, steps = 0, minY = 1e9;
    const run = T.simulate(6, (t, sim, cmd, ov) => {
      ov.pathTarget = -2.5 * DEG;
      steps++; if (sim.touchingWater) touching++;
      minY = Math.min(minY, sim.body.position.y);
    }, 0.25);
    const a = run.samples[0], b = run.final;
    // Hands-off after the skim climbs back to a safe height; L then puts the dragon down on the water.
    const handsOff = T.simulate(6, null, 1);
    const settle = T.simulate(30, (t, sim, cmd) => { cmd.landPressed = t < 0.004; }, 1, (sim) => sim.mode === 'swimming' && sim.modeTime > 3);
    const swim = T.simulate(4, (t, sim, cmd) => { cmd.pitch = 1; });
    let tFly = null;
    const to = T.simulate(10, (t, sim, cmd) => { cmd.flapPressed = t < 0.004; if (tFly === null && sim.mode === 'flying') tFly = t; });
    return {
      splashes: run.events.splash, touchingFraction: r2(touching / steps), speedStart: a.airspeed, speedEnd: b.airspeed, minComY: r2(minY),
      modeAfterSkim: b.mode, footClearanceHandsOff6s: handsOff.final.footClearance, modeAfterLandOnWater: settle.final.mode, swimSpeed: swim.final.groundSpeed,
      waterTakeoff: { secondsToFlying: tFly && r1(tFly), altitude10s: r1(to.final.y), mode: to.final.mode, splashes: to.events.splash },
    };
  `,
  wHold: `
    // W held (nose down) must never pass the pitch limit, flip inverted or stay upside down.
    calm();
    const w = water();
    const out = {};
    for (const [label, alt, hold, dive] of [['high5s', 1500, 5, false], ['low3s', 250, 3, false], ['shiftW6s', 2000, 6, true]]) {
      T.teleport(w.x, alt, w.z, 20, 0, 32);
      T.simulate(3);
      let minPitch = 0, maxBank = 0, minLoad = 9, stallSteps = 0, steps = 0, recovered = null, minClear = 1e9, invertedAfter = 0;
      const run = T.simulate(hold + 12, (t, sim, cmd) => {
        cmd.pitch = t < hold ? 1 : 0;
        cmd.dive = dive && t < hold;
        steps++;
        minPitch = Math.min(minPitch, sim.pitch / DEG);
        maxBank = Math.max(maxBank, Math.abs(sim.bank) / DEG);
        minLoad = Math.min(minLoad, sim.loadFactor);
        minClear = Math.min(minClear, sim.footClearance);
        if (sim.mode === 'stalling') stallSteps++;
        if (t > hold && Math.abs(sim.bank) > 90 * DEG) invertedAfter++;
        if (t > hold && recovered === null && Math.abs(sim.bank) < 10 * DEG && Math.abs(sim.gamma) < 5 * DEG) recovered = t - hold;
      });
      out[label] = { minPitchDeg: r1(minPitch), maxAbsBankDeg: r1(maxBank), minLoadFactor: r2(minLoad), stallingSeconds: r2(stallSteps / 120), invertedSecondsAfterRelease: r2(invertedAfter / 120), levelAfterReleaseSec: recovered && r1(recovered), minFootClearance: r1(minClear), finalMode: run.final.mode, impacts: run.events.impact };
    }
    return out;
  `,
  rudder: `
    calm();
    const w = water();
    T.teleport(w.x, 500, w.z, 20, 0, 32);
    T.simulate(4);
    const h0 = T.state().headingDeg;
    let maxBeta = 0;
    const run = T.simulate(5, (t, sim, cmd) => { cmd.yaw = -1; maxBeta = Math.max(maxBeta, Math.abs(sim.beta) / DEG); }, 0.5);
    let dh = run.final.headingDeg - h0; dh = ((dh + 540) % 360) - 180;
    return { maxSideslipDeg: r1(maxBeta), bankDeg: run.final.bankDeg, headingChangeDeg: r1(dh), altitudeChange: r1(run.final.y - run.samples[0].y) };
  `,
  lowIdle: `
    // Hands-off 8 m above land: must climb to a safe clearance and never scrape.
    T.options({ wind: true, turbulence: true, thermals: true, autoFlap: true, stallProtection: true });
    const p0 = T.sim.body.position;
    const spot = T.findSpot('land', p0.x, p0.z, 9000, 120);
    if (!spot) return { error: 'no land' };
    const out = {};
    for (const heading of [90, 270, 0]) {
      T.teleport(spot.x, spot.y + 8, spot.z, heading, 0, 22);
      let touch = 0, steps = 0, minClear = 1e9, minTip = 1e9;
      const run = T.simulate(60, (t, sim) => {
        steps++;
        if (sim.footClearance < 0.05) touch++;
        if (t > 4) minClear = Math.min(minClear, sim.footClearance);
        const half = sim.wing.span / 2, r = sim.axes.right, q = sim.body.position, col = sim.world.collision;
        for (const s of [1, -1]) { const x = q.x + r.x * half * s, y = q.y + r.y * half * s, z = q.z + r.z * half * s; minTip = Math.min(minTip, y - col.surfaceHeight(x, z)); }
      }, 1);
      const clear = run.samples.map((s) => s.footClearance);
      out['hdg' + heading] = { touchFraction: r2(touch / steps), minFootClearanceAfter4s: r1(minClear), meanClearance: r1(mean(clear)), minWingtipClearance: r1(minTip), impacts: run.events.impact, dust: run.events.dust, finalMode: run.final.mode };
    }
    return out;
  `,
  lowBank: `
    calm();
    const p0 = T.sim.body.position;
    const spot = T.findSpot('land', p0.x, p0.z, 9000, 200);
    if (!spot) return { error: 'no land' };
    const out = {};
    for (const agl of [8, 15]) {
      T.teleport(spot.x, spot.y + agl, spot.z, 90, 0, 30);
      let minTip = 1e9, maxBank = 0, minClear = 1e9, minRigTip = 1e9;
      T.simulate(6, (t, sim, cmd) => {
        cmd.roll = 1;
        const half = sim.wing.span / 2, r = sim.axes.right, q = sim.body.position, col = sim.world.collision;
        for (const s of [1, -1]) { const x = q.x + r.x * half * s, y = q.y + r.y * half * s, z = q.z + r.z * half * s; minTip = Math.min(minTip, y - col.surfaceHeight(x, z)); }
        minRigTip = Math.min(minRigTip, tipNow());
        maxBank = Math.max(maxBank, Math.abs(sim.bank) / DEG);
        minClear = Math.min(minClear, sim.footClearance);
      });
      // flatWing: rigid flat wing at CoM height (conservative); rigTip: the rig's wing (dihedral + stroke) over flat ground.
      out['agl' + agl] = { minFlatWingTipClearance: r1(minTip), minRigTipClearance: r1(minRigTip), maxBankDeg: r1(maxBank), minFootClearance: r1(minClear) };
    }
    return out;
  `,
  brakeLow: `
    calm();
    const p0 = T.sim.body.position;
    const spot = T.findSpot('land', p0.x, p0.z, 9000, 320);
    if (!spot) return { error: 'no land' };
    T.teleport(spot.x - 150, spot.y + 8 + T.sim.contacts.bellyDepth, spot.z, 90, 0, 22);
    let tHover = null, tLanding = null, tGround = null, maxClear = 0;
    T.simulate(20, (t, sim, cmd) => {
      cmd.brake = true;
      if (tHover === null && sim.mode === 'hovering') tHover = t;
      if (tLanding === null && sim.mode === 'landing') tLanding = t;
      if (tGround === null && sim.mode === 'grounded') tGround = t;
      if (tHover !== null && tGround === null) maxClear = Math.max(maxClear, sim.footClearance);
    });
    const afterBrake = T.simulate(4);
    // Latched hover: brake, release, stays hovering; Shift descends; W flies out.
    const w = water();
    T.teleport(w.x, 200, w.z, 20, 0, 25);
    T.simulate(8, (t, sim, cmd) => { cmd.brake = true; });
    const hovering = T.state().mode;
    const y0 = T.state().y;
    const rel = T.simulate(5);
    const desc = T.simulate(3, (t, sim, cmd) => { cmd.dive = true; });
    let tOut = null;
    const out = T.simulate(10, (t, sim, cmd) => { cmd.pitch = 1; if (tOut === null && sim.mode === 'flying') tOut = t; });
    return {
      secondsToHover: tHover && r1(tHover), secondsToLanding: tLanding && r1(tLanding), secondsToGrounded: tGround && r1(tGround), maxHoverClearance: r1(maxClear), modeAfterRelease: afterBrake.final.mode,
      latch: { modeAfterBrake: hovering, modeAfterRelease5s: rel.final.mode, driftAfterRelease: r2(rel.final.y - y0), descentRateWithShift: r2((desc.final.y - rel.final.y) / 3), modeWithShift: desc.final.mode, secondsToFlyingWithW: tOut && r1(tOut), modeAfterW: out.final.mode },
    };
  `,
  waterLand: `
    calm();
    const w = water();
    T.teleport(w.x, 80, w.z, 20, 0, 28);
    let tSwim = null, maxLanding = 0;
    const run = T.simulate(40, (t, sim, cmd) => {
      cmd.landPressed = t < 0.004;
      if (tSwim === null && sim.mode === 'swimming') tSwim = t;
    }, 1, (sim) => sim.mode === 'swimming' && sim.modeTime > 2);
    // Fast plunge (test-only path override): impact event + speed bled over ~0.4 s, not a dead stop.
    T.teleport(w.x, 40, w.z, 20, -30, 45);
    T.options({ stallProtection: false });
    let entry = null, v03 = null, v06 = null;
    const plunge = T.simulate(6, (t, sim, cmd, ov) => {
      if (entry === null) ov.pathTarget = -35 * DEG;
      if (entry === null && sim.mode === 'swimming') entry = { t, v: Math.hypot(sim.body.velocity.x, sim.body.velocity.z) };
      if (entry && v03 === null && t >= entry.t + 0.3) v03 = Math.hypot(sim.body.velocity.x, sim.body.velocity.z);
      if (entry && v06 === null && t >= entry.t + 0.6) v06 = Math.hypot(sim.body.velocity.x, sim.body.velocity.z);
    });
    T.options({ stallProtection: true });
    return {
      landInWater: { secondsToSwimming: tSwim && r1(tSwim), staminaAtEntry: run.final.stamina, splashes: run.events.splash },
      plunge: { impacts: plunge.events.impact, splashes: plunge.events.splash, speedAtEntry: entry && r1(entry.v), speedAfter03s: v03 && r1(v03), speedAfter06s: v06 && r1(v06), finalMode: plunge.final.mode },
    };
  `,
  spaceTap: `
    calm();
    const w = water();
    T.options({ autoFlap: false });
    T.teleport(w.x, 400, w.z, 20, 0, 30);
    T.simulate(6);
    const base = T.simulate(3);
    T.teleport(w.x, 400, w.z, 20, 0, 30);
    T.simulate(6);
    let peak = 0;
    const tap = T.simulate(3, (t, sim, cmd) => { cmd.flapPressed = t < 0.004; peak = Math.max(peak, sim.beat.effort); });
    T.options({ autoFlap: true });
    const e = (r) => r.final.airspeed * r.final.airspeed / 2 + 9.81 * r.final.y;
    return { flapEventsFromTap: tap.events.flap, peakEffort: r2(peak), energyGainVsGlide: r1(e(tap) - e(base)) };
  `,
  boundary: `
    calm();
    const land = T.probe(23800, 0);
    T.teleport(23800, Math.max(0, land ? land.surface : 0) + 60, 0, 90, 0, 5);
    let maxX = 0;
    T.simulate(8, (t, sim, cmd) => { cmd.brake = true; });
    const run = T.simulate(120, (t, sim, cmd) => { cmd.pitch = 1; cmd.brake = true; maxX = Math.max(maxX, Math.abs(sim.body.position.x)); });
    return { maxAbsX: Math.round(maxX), finalMode: run.final.mode };
  `,
  presets: `
    // Hands-off from every view preset for 90 s: no impacts, no scraping.
    T.options({ wind: true, turbulence: true, thermals: true, autoFlap: true, stallProtection: true });
    const out = {};
    for (const name of window.__evren.views()) {
      T.view(name, 40);
      let minClear = 1e9;
      const run = T.simulate(90, (t, sim) => { minClear = Math.min(minClear, sim.footClearance); }, 5);
      out[name] = { impacts: run.events.impact, minFootClearance: r1(minClear), finalMode: run.final.mode };
    }
    return out;
  `,
  sHold: `
    // Pilot inputs only: the basic keyboard climb (S) and turns must never stall. Airspeed is judged against the
    // stall speed at the turn's load factor, Vs(n) = Vs1 · sqrt(1 / cos bank).
    const out = {};
    const w = water();
    const cases = [
      ['S10', 300, 10, (t, sim, cmd) => { cmd.pitch = -1; }],
      ['SpaceS20', 300, 20, (t, sim, cmd) => { cmd.pitch = -1; cmd.flap = true; }],
      ['SpaceHalfS20_2600m', 2600, 20, (t, sim, cmd) => { cmd.pitch = -0.5; cmd.flap = true; }],
      ['S2.5ThenRelease', 300, 14, (t, sim, cmd) => { cmd.pitch = t < 2.5 ? -1 : 0; }],
      ['D10', 300, 10, (t, sim, cmd) => { cmd.roll = 1; }],
      ['DS10', 300, 10, (t, sim, cmd) => { cmd.roll = 1; cmd.pitch = -1; }],
    ];
    for (const windy of [false, true]) {
      for (const [label, alt, secs, fn] of cases) {
        T.options({ wind: windy, turbulence: windy, thermals: windy, autoFlap: true, stallProtection: true });
        T.wind(windy ? 6 : null, windy ? 4 : 0);
        T.setStamina(1);
        T.teleport(w.x, alt, w.z, 20, 0, 32);
        T.simulate(3);
        const vs1 = T.envelope().stallSpeed * Math.sqrt(Math.max(Math.cos(T.sim.bank), 0.45));
        let minRatio = 9, minV = 99, maxPitch = -99, stall = 0, minAtt = 1, lateV = [], lateGamma = [];
        const y0 = T.state().y;
        const r = T.simulate(secs, (t, sim, cmd) => {
          fn(t, sim, cmd);
          if (t > 0.5) {
            const vsn = vs1 * Math.sqrt(1 / Math.max(Math.cos(sim.bank), 0.3));
            minRatio = Math.min(minRatio, sim.airspeed / vsn);
            minV = Math.min(minV, sim.airspeed);
          }
          if (t > secs - 4) { lateV.push(sim.airspeed); lateGamma.push(sim.gamma / DEG); }
          maxPitch = Math.max(maxPitch, sim.pitch / DEG);
          if (sim.mode === 'stalling') stall++;
          minAtt = Math.min(minAtt, sim.attachment);
        }, 1);
        out[(windy ? 'wind_' : 'calm_') + label] = {
          ok: minRatio >= 1.2 && stall === 0, minAirspeedOverVsN: r2(minRatio), minAirspeed: r1(minV), vs1g: r1(vs1), maxPitchDeg: r1(maxPitch),
          stallingSec: r2(stall / 120), minAttachment: r2(minAtt), lateAirspeed: r1(mean(lateV)), lateClimbDeg: r1(mean(lateGamma)), altitudeGain: r1(r.final.y - y0),
        };
      }
    }
    return out;
  `,
  turnPilot: `
    // D held at 0.92 (≈60° bank), no overrides: coordinated, level, no stall.
    const w = water();
    const out = {};
    for (const windy of [false, true]) {
      T.options({ wind: windy, turbulence: windy, thermals: windy, autoFlap: true, stallProtection: true });
      T.wind(windy ? 8 : null, 0);
      T.teleport(w.x, 600, w.z, 20, 0, 32);
      T.simulate(3);
      T.simulate(5, (t, sim, cmd) => { cmd.roll = 0.92; });
      const a = T.state();
      let prev = T.sim.axes.yaw(), total = 0;
      const run = T.simulate(20, (t, sim, cmd) => { cmd.roll = 0.92; const y = unwrap(prev, sim.axes.yaw()); total += y - prev; prev = y; }, 0.25);
      const s = run.samples;
      out[windy ? 'wind8' : 'calm'] = {
        turnRateDegPerSec: r1(-total / DEG / 20), bankDeg: r1(mean(s.map((x) => x.bankDeg))), loadFactor: r2(mean(s.map((x) => x.loadFactor))),
        airspeed: r1(mean(s.map((x) => x.airspeed))), minAirspeed: r1(Math.min(...s.map((x) => x.airspeed))), altitudeChange: r1(run.final.y - a.y),
        sideslipDeg: r1(mean(s.map((x) => Math.abs(x.betaDeg)))), stalling: s.filter((x) => x.mode === 'stalling').length,
      };
    }
    return out;
  `,
  hoverWind: `
    // Latched hover in a headwind: holding W must fly out (it used to stick at >= 4 m/s headwind), holding W
    // after the exit must not dive, and a hands-off hover must hold position and height in wind.
    T.options({ wind: true, turbulence: true, thermals: true, autoFlap: true, stallProtection: true });
    const w = water();
    const out = {};
    for (const head of [0, 4, 8, 12]) {
      T.setStamina(1);
      T.wind(0, head);
      T.teleport(w.x, 60, w.z, 0, 0, 25);
      T.simulate(8, (t, sim, cmd) => { cmd.brake = true; });
      const m0 = T.state().mode, y0 = T.state().y;
      let tExit = null, minY = 1e9;
      const r = T.simulate(8, (t, sim, cmd) => { cmd.pitch = t < 4 ? 1 : 0; if (tExit === null && sim.mode !== 'hovering') tExit = t; minY = Math.min(minY, sim.body.position.y); }, 1);
      out['exitHeadwind' + head] = { ok: tExit !== null && tExit <= 1.5 && y0 - minY < 8, modeAfterBrake: m0, secondsToExit: tExit && r1(tExit), altitudeLost: r1(y0 - minY), finalMode: r.final.mode, finalAirspeed: r1(r.final.airspeed) };
    }
    for (const [label, wx, wz] of [['cross10', 10, 0], ['head10', 0, 10], ['calm', 0, 0]]) {
      T.setStamina(1);
      T.wind(wx, wz);
      T.teleport(w.x, 80, w.z, 0, 0, 25);
      T.simulate(8, (t, sim, cmd) => { cmd.brake = true; });
      T.simulate(8);
      const a = T.state();
      const r = T.simulate(15, null, 0.5);
      const gs = r.samples.map((s) => s.groundSpeed);
      out['holdHandsOff_' + label] = { ok: r.final.mode === 'hovering' && mean(gs) < 1 && Math.abs(r.final.y - a.y) < 1.5, mode: r.final.mode, meanGroundSpeed: r2(mean(gs)), maxGroundSpeed: r2(Math.max(...gs)), heightDrift: r2(r.final.y - a.y), maxAbsBankDeg: r1(Math.max(...r.samples.map((s) => Math.abs(s.bankDeg)))) };
    }
    return out;
  `,
  landWind: `
    // L from 45 m in calm air and in cross/tail/head winds with turbulence: no big bank or yaw in the last metres,
    // wingtips clear of the ground, a slow touchdown.
    const p0 = T.sim.body.position;
    const s = T.findSpot('land', p0.x, p0.z, 9000, 320);
    if (!s) return { error: 'no flat land found' };
    const out = { spot: [Math.round(s.x), Math.round(s.z)] };
    for (const [label, wind] of [['calm', null], ['env', 'env'], ['crossN8', [0, 8]], ['crossS8', [0, -8]], ['tail8', [8, 0]], ['head10', [-10, 0]]]) {
      const windy = wind !== null;
      T.options({ wind: windy, turbulence: windy, thermals: windy, autoFlap: true, stallProtection: true });
      T.wind(Array.isArray(wind) ? wind[0] : null, Array.isArray(wind) ? wind[1] : 0);
      T.setStamina(1);
      T.teleport(s.x - 200, s.y + 45, s.z, 90, 0, 24);
      let tGround = null, touchGs = null, maxBankLow = 0, minTip = 1e9, yaws = [], maxBankDescent = 0;
      const r = T.simulate(60, (t, sim, cmd) => {
        cmd.landPressed = t < 0.004;
        if (sim.mode === 'landing' || sim.mode === 'hovering') minTip = Math.min(minTip, tipNow());
        if (sim.mode === 'landing' && sim.controller.hoverDescent) maxBankDescent = Math.max(maxBankDescent, Math.abs(sim.bank) / DEG);
        if (sim.mode === 'landing' && sim.footClearance < 4) maxBankLow = Math.max(maxBankLow, Math.abs(sim.bank) / DEG);
        if (sim.mode === 'landing' && sim.footClearance < 3) yaws.push(yaws.length ? unwrap(yaws[yaws.length - 1], sim.axes.yaw()) : sim.axes.yaw());
        if (tGround === null && sim.mode === 'grounded') { tGround = t; touchGs = Math.hypot(sim.body.velocity.x, sim.body.velocity.z); }
      }, 1, (sim) => sim.mode === 'grounded' && sim.modeTime > 0.5);
      const yawSpan = yaws.length ? (Math.max(...yaws) - Math.min(...yaws)) / DEG : 0;
      out[label] = {
        ok: tGround !== null && maxBankLow < 10 && yawSpan < 12 && minTip > 1 && r.events.impact === 0,
        secondsToGround: tGround && r1(tGround), touchdownGroundSpeed: touchGs && r1(touchGs), maxBankHoverDescentDeg: r1(maxBankDescent), maxBankBelow4mDeg: r1(maxBankLow),
        yawChangeLast3mDeg: r1(yawSpan), minWingtipClearance: r1(minTip), impacts: r.events.impact, finalMode: r.final.mode,
      };
    }
    return out;
  `,
  brakeLowWind: `
    // Brake 8-12 m over land into / across the wind: hover, settle and touch down without impacts.
    const p0 = T.sim.body.position;
    const s = T.findSpot('land', p0.x, p0.z, 9000, 320);
    if (!s) return { error: 'no land' };
    const out = {};
    for (const [label, wx, wz] of [['calm', null, 0], ['head6', 0, 6], ['cross8', 8, 0], ['tail6', 0, -6]]) {
      T.options({ wind: wx !== null, turbulence: wx !== null, thermals: wx !== null, autoFlap: true, stallProtection: true });
      T.wind(wx, wz);
      T.setStamina(1);
      const ground = T.probe(s.x, s.z + 120).surface;
      T.teleport(s.x, ground + 10 + T.sim.contacts.bellyDepth, s.z + 120, 0, 0, 22);
      let tGround = null, minTip = 1e9, maxBankLow = 0;
      const r = T.simulate(40, (t, sim, cmd) => {
        cmd.brake = true;
        if (sim.airborne) minTip = Math.min(minTip, tipNow());
        if (sim.airborne && sim.footClearance < 4) maxBankLow = Math.max(maxBankLow, Math.abs(sim.bank) / DEG);
        if (tGround === null && sim.mode === 'grounded') tGround = t;
      }, 1, (sim) => sim.mode === 'grounded' && sim.modeTime > 0.5);
      out[label] = { ok: tGround !== null && r.events.impact === 0 && minTip > 1, secondsToGround: tGround && r1(tGround), impacts: r.events.impact, minWingtipClearance: r1(minTip), maxBankBelow4mDeg: r1(maxBankLow), finalMode: r.final.mode };
    }
    return out;
  `,
  fire: `
    // F while gliding drains stamina slowly (regeneration pauses while breathing fire).
    calm();
    const w = water();
    T.teleport(w.x, 500, w.z, 20, 0, 30);
    T.simulate(3);
    T.setStamina(0.8);
    const a = T.state();
    const r = T.simulate(10, (t, sim, cmd) => { cmd.fire = true; });
    const b = r.final;
    const glide = T.simulate(10);
    return { ok: b.stamina < a.stamina, staminaStart: a.stamina, staminaAfter10sFire: b.stamina, perSecond: r2((b.stamina - a.stamina) / 10 * 100) / 100, staminaAfter10sGlide: glide.final.stamina, firing: b.firing };
  `,
  collide: `
    calm();
    T.view(new URLSearchParams(location.search).get('view') || 'spawn', 35);
    const col = T.sim.world.collision;
    const p = T.sim.body.position;
    let hit = null;
    for (let a = 0; a < 360 && !hit; a += 10) {
      const dir = { x: Math.sin(a * DEG), y: 0, z: -Math.cos(a * DEG) };
      for (const y of [40, 80, 140]) {
        const o = new window.__evren.THREE.Vector3(p.x, col.groundHeight(p.x, p.z) + y, p.z);
        const d = new window.__evren.THREE.Vector3(dir.x, 0, dir.z);
        const h = col.raycast(o, d, 3000, false);
        if (h && h.surface !== 'ground' && h.surface !== 'water' && h.distance > 200) { hit = { o, heading: a, dist: h.distance, surface: h.surface }; break; }
      }
    }
    if (!hit) return { skipped: 'no structure collider within 3 km' };
    T.teleport(hit.o.x, hit.o.y, hit.o.z, hit.heading, 0, 35);
    let minSpeed = 99, nanFree = true, tImpact = null, tRecovered = null, minAgl = 1e9;
    const run = T.simulate(20, (t, sim) => {
      if (!Number.isFinite(sim.body.position.x)) nanFree = false;
      minSpeed = Math.min(minSpeed, sim.airspeed);
      if (tImpact === null && sim.impact.speed > 0) tImpact = t;
      if (tImpact !== null) minAgl = Math.min(minAgl, sim.agl);
      if (tImpact !== null && tRecovered === null && t > tImpact + 0.3 && sim.attachment > 0.9 && Math.abs(sim.bank) < 20 * DEG && sim.airspeed > 16 && Math.abs(sim.gamma) < 0.35) tRecovered = t;
    });
    return {
      surface: hit.surface, distance: Math.round(hit.dist), impacts: run.events.impact, minAirspeed: r1(minSpeed), secondsToRecover: tRecovered && tImpact !== null ? r1(tRecovered - tImpact) : null,
      minAglAfterImpact: r1(minAgl), finalMode: run.final.mode, finalAirspeed: run.final.airspeed, nanFree,
    };
  `,
};

/* ------------------------------------------------------------------------------------------------ */

/**
 * Third-person screenshots. Each job fast-forwards the simulation into the manoeuvre (so a dev-server reload
 * cannot interrupt a long real-time wait), snaps the camera, lets it render ~0.8 s in real time, then shoots.
 */
const SHOT_JOBS = [
  { name: 'cruise', setup: `T.simulate(4); T.snapCamera();` },
  { name: 'turn60', setup: `T.input({ bankDeg: 60, pathDeg: 0 }); T.simulate(4); T.snapCamera();` },
  { name: 'climb', setup: `T.input({ flap: true, airspeed: 24 }); T.simulate(4); T.snapCamera();` },
  { name: 'dive', setup: `const p = T.sim.body.position; T.teleport(p.x, 1500, p.z, 30, 0, 40); T.input({ dive: true }); T.simulate(7); T.snapCamera();` },
  { name: 'hover', setup: `T.input({ brake: true }); T.simulate(9); T.snapCamera();` },
  {
    name: 'flare',
    setup: `const p = T.sim.body.position; const s = T.findSpot('land', p.x, p.z, 9000, 320);
      T.teleport(s.x - 200, s.y + 45, s.z, 90, 0, 24);
      T.simulate(30, (t, sim, cmd) => { cmd.landPressed = t < 0.004; }, 1, (sim) => sim.mode === 'landing' && sim.controller.hoverDescent && sim.footClearance < 3.5);
      T.snapCamera();`,
  },
  { name: 'walk', setup: `const p = T.sim.body.position; const s = T.findSpot('land', p.x, p.z, 9000, 200); T.teleport(s.x, s.y + 3, s.z, 90, 0, 0); T.ground(); T.input({ pitch: 1 }); T.simulate(2); T.snapCamera();` },
  { name: 'skim', setup: `const p = T.sim.body.position; T.teleport(p.x, T.sim.contacts.bellyDepth + 0.3, p.z, 30, 0, 30); T.input({ pathDeg: 0 }); T.simulate(1); T.snapCamera();` },
  { name: 'swim', setup: `const p = T.sim.body.position; T.teleport(p.x, 0, p.z, 30, 0, 0); T.ground(); T.input({ pitch: 1, roll: 0.3 }); T.simulate(2); T.snapCamera();` },
  /* Pilot-input states from the review (no test overrides). */
  { name: 'wheld', setup: `T.input({ pitch: 1 }); T.simulate(3); T.snapCamera();` },
  { name: 'rudder', setup: `T.input({ yaw: -1 }); T.simulate(4); T.snapCamera();` },
  {
    name: 'lowbank',
    setup: `const p = T.sim.body.position; const s = T.findSpot('land', p.x, p.z, 9000, 200);
      T.teleport(s.x, s.y + 8, s.z, 90, 0, 30); T.input({ roll: 1 }); T.simulate(2.5); T.snapCamera();`,
  },
  {
    name: 'lowidle',
    setup: `const p = T.sim.body.position; const s = T.findSpot('land', p.x, p.z, 9000, 120);
      T.teleport(s.x, s.y + 8, s.z, 270, 0, 22); T.simulate(12); T.snapCamera();`,
  },
  {
    name: 'brakeland',
    setup: `const p = T.sim.body.position; const s = T.findSpot('land', p.x, p.z, 9000, 320);
      T.teleport(s.x - 150, s.y + 10, s.z, 90, 0, 22); T.input({ brake: true });
      T.simulate(20, null, 1, (sim) => sim.mode === 'landing' && sim.footClearance < 2.5); T.snapCamera();`,
  },
  {
    name: 'waterland',
    setup: `const p = T.sim.body.position; const w = T.findSpot('water', p.x, p.z, 6000);
      T.teleport(w.x, 80, w.z, 30, 0, 28);
      T.simulate(40, (t, sim, cmd) => { cmd.landPressed = t < 0.004; }, 1, (sim) => sim.mode === 'swimming' && sim.modeTime > 0.4); T.snapCamera();`,
  },
  /* Review round 2: pilot-only climb, crosswind landing, hover in wind. */
  { name: 'shold', setup: `T.input({ pitch: -1 }); T.simulate(5); T.snapCamera();` },
  {
    name: 'crossland',
    setup: `const p = T.sim.body.position; const s = T.findSpot('land', p.x, p.z, 9000, 320);
      T.wind(0, 8); T.teleport(s.x - 200, s.y + 45, s.z, 90, 0, 24);
      T.simulate(60, (t, sim, cmd) => { cmd.landPressed = t < 0.004; }, 1, (sim) => sim.mode === 'landing' && sim.controller.hoverDescent && sim.footClearance < 2 && Math.hypot(sim.body.velocity.x, sim.body.velocity.z) < 3);
      T.snapCamera();`,
  },
  { name: 'hoverwind', setup: `T.wind(8, 0); T.input({ brake: true }); T.simulate(8); T.input(null); T.simulate(6); T.snapCamera();` },
  {
    name: 'pilotskim',
    setup: `const p = T.sim.body.position; const w = T.findSpot('water', p.x, p.z, 6000);
      T.teleport(w.x, 6, w.z, 30, 0, 32); T.input({ pitch: 0.35 }); T.simulate(2.2); T.snapCamera();`,
  },
];

/** Keeps the shared dev server's hot reload (other modules being edited) from reloading a page mid-test. */
async function blockHotReload(page) {
  await page.addInitScript(() => {
    const NativeSocket = window.WebSocket;
    class Stub extends EventTarget {
      constructor() {
        super();
        this.readyState = 0;
      }
      send() {}
      close() {}
    }
    window.WebSocket = function (url, protocol) {
      if (protocol === 'vite-hmr' || String(url).includes('token=')) return new Stub();
      return new NativeSocket(url, protocol);
    };
  });
}

async function shoot(browser, job) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const p = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
    try {
      await blockHotReload(p);
      await p.goto(BASE + URL_PATH, { waitUntil: 'load', timeout: 60000 });
      const t1 = Date.now();
      while (Date.now() - t1 < 60000) {
        const ok = await p.evaluate(() => !!window.__flightTest && !!window.__evren?.ready && window.__evren.pending() === 0).catch(() => false);
        if (ok) break;
        await p.waitForTimeout(250);
      }
      await p.evaluate(`(() => { window.__shotToken = 1; const T = window.__flightTest; T.options({ turbulence: false }); ${job.setup} })()`);
      await p.waitForTimeout(800);
      const alive = await p.evaluate(() => window.__shotToken === 1).catch(() => false);
      if (!alive) {
        await p.close();
        continue;
      }
      const out = `${SHOTS}/test-${job.name}.png`;
      await p.screenshot({ path: out });
      const st = await p.evaluate(() => window.__flightTest.state());
      await p.close();
      return { out, mode: st.mode, airspeed: st.airspeed, bankDeg: st.bankDeg, pitchDeg: st.pitchDeg };
    } catch (e) {
      await p.close().catch(() => undefined);
      if (attempt === 3) return { error: String(e.message || e).slice(0, 200) };
    }
  }
  return { error: 'page kept reloading' };
}

async function main() {
  try {
    const r = await fetch(BASE + '/');
    if (!r.ok) throw new Error(String(r.status));
  } catch {
    console.error(`Dev server not reachable at ${BASE}`);
    process.exit(2);
  }
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'],
  });
  const results = {};
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text().slice(0, 300));
    });
    const waitReady = async () => {
      const t0 = Date.now();
      while (Date.now() - t0 < 60000) {
        const ok = await page.evaluate(() => !!window.__flightTest && !!window.__evren?.ready).catch(() => false);
        if (ok) return;
        await page.waitForTimeout(250);
      }
    };
    await blockHotReload(page);
    await page.goto(BASE + URL_PATH, { waitUntil: 'load', timeout: 60000 });
    await waitReady();
    const names = ONLY.length ? ONLY : Object.keys(MANEUVERS);
    for (const name of names) {
      const body = MANEUVERS[name];
      if (!body) {
        results[name] = { error: 'unknown manoeuvre' };
        continue;
      }
      const t = Date.now();
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          results[name] = await page.evaluate(`(() => { ${PREAMBLE} ${body} })()`);
          break;
        } catch (e) {
          const msg = String(e.message || e);
          results[name] = { error: msg.slice(0, 400) };
          // The shared dev server reloads pages when other modules change: wait and retry.
          if (!/destroyed|navigation|undefined/.test(msg)) break;
          await page.waitForTimeout(1500);
          await waitReady();
        }
      }
      results[name].wallMs = Date.now() - t;
    }
    await page.evaluate(() => window.__flightTest.input(null));
    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true });
      for (const job of SHOT_JOBS.filter((j) => !SHOT_ONLY.length || SHOT_ONLY.includes(j.name))) {
        results[`shot:${job.name}`] = await shoot(browser, job);
      }
    }
  } finally {
    await browser.close();
  }
  if (JSON_ONLY) {
    console.log(JSON.stringify({ results, errors }, null, 1));
    return;
  }
  for (const [name, r] of Object.entries(results)) {
    console.log(`\n== ${name} ==`);
    console.log(JSON.stringify(r, null, 1));
  }
  if (errors.length) {
    console.log('\nconsole errors:\n' + errors.slice(0, 20).join('\n'));
  }
}

await main();
