import type { DragonPose } from '../../../../core/contracts';
import type { BondOutputs } from './types';

/**
 * The bond core's offsets on top of this frame's flight pose (pure; the adapter and the headless pose sheets both use
 * it). `pov`: the POV camera rides on the rider, so a body rock is kept small there.
 */
export function bondPose(pose: Readonly<DragonPose>, o: BondOutputs, pov: boolean): Partial<DragonPose> {
  const p: Partial<DragonPose> = {
    neckYaw: pose.neckYaw + o.neckYaw,
    neckPitch: pose.neckPitch + o.neckPitch,
    jawOpen: Math.max(pose.jawOpen, o.jawMin),
    tailYaw: pose.tailYaw + o.tailYaw,
    tailPitch: pose.tailPitch + o.tailPitch,
    gazeRider: o.gazeRider,
    eyeLid: o.eyeLid,
    pupil: o.pupil,
    neckPlates: o.neckPlates,
    headRoll: o.headRoll,
    neckShake: o.neckShake,
    bodyRoll: o.bodyRoll * (pov ? 0.3 : 1),
    tailCurl: o.tailCurl,
    riderLaugh: Math.max(pose.riderLaugh ?? 0, o.riderLaugh),
    riderShow: o.riderShow,
    riderShowYaw: o.riderShowYaw,
    riderShowPitch: o.riderShowPitch,
    riderPat: o.riderPat,
  };
  if (o.wingWeight > 0.001) {
    p.wingSpread = pose.wingSpread + (o.wingSpread - pose.wingSpread) * o.wingWeight;
    p.wingRaise = Math.max(pose.wingRaise ?? 0, o.wingRaise);
  }
  if (o.beatWeight > 0.01) {
    p.flapPhase = o.beatPhase;
    p.flapAmplitude = Math.max(pose.flapAmplitude, 0.85 * o.beatWeight);
  }
  return p;
}
