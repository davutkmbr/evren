import type { Input } from '../../core/input';
import { clamp } from '../../core/math/noise';
import { DEG } from './params';
import type { FlightSim } from './sim';
import type { AssistOverrides, PilotCommand } from './types';

/** Reads the action-mapped input (keyboard/gamepad; pitch inversion already applied by Input). */
export function readPilotInput(input: Input, out: PilotCommand): PilotCommand {
  out.pitch = input.axis('pitch');
  out.roll = input.axis('roll');
  out.yaw = input.axis('yaw');
  out.flap = input.isHeld('flap');
  out.dive = input.isHeld('dive');
  out.brake = input.isHeld('brake');
  out.fire = input.isHeld('fire');
  out.flapPressed = input.wasPressed('flap');
  out.landPressed = input.wasPressed('land');
  out.roarPressed = input.wasPressed('roar');
  out.rollLeftPressed = input.wasDoubleTapped('rollLeft');
  out.rollRightPressed = input.wasDoubleTapped('rollRight');
  out.loopPressed = input.wasDoubleTapped('pitchUp');
  out.dropPressed = input.wasDoubleTapped('dive');
  out.urgePressed = input.wasPressed('urge');
  out.powerPressed = input.wasDoubleTapped('flap');
  out.slipLeftPressed = input.wasDoubleTapped('yawLeft');
  out.slipRightPressed = input.wasDoubleTapped('yawRight');
  return out;
}

export function hasPilotInput(cmd: PilotCommand): boolean {
  return (
    Math.abs(cmd.pitch) > 0.05 ||
    Math.abs(cmd.roll) > 0.05 ||
    Math.abs(cmd.yaw) > 0.05 ||
    cmd.flap ||
    cmd.dive ||
    cmd.brake ||
    cmd.landPressed ||
    cmd.rollLeftPressed ||
    cmd.rollRightPressed ||
    cmd.loopPressed ||
    cmd.dropPressed ||
    cmd.urgePressed ||
    cmd.powerPressed ||
    cmd.slipLeftPressed ||
    cmd.slipRightPressed
  );
}

/**
 * Screenshot/demo autopilot: holds the altitude it started at (never closer than ~70 m to the surface)
 * and flies a wide, gentle right-hand circle; cruise flapping comes from the governor ("relaxed flaps").
 */
export class Autopilot {
  private holdAltitude: number | null = null;
  bankDeg = 12;

  reset(): void {
    this.holdAltitude = null;
  }

  apply(sim: FlightSim, cmd: PilotCommand, overrides: AssistOverrides): void {
    const y = sim.body.position.y;
    if (this.holdAltitude === null) {
      this.holdAltitude = y;
    }
    this.holdAltitude = Math.max(this.holdAltitude, sim.surfaceY + 70);
    cmd.pitch = 0;
    cmd.roll = 0;
    cmd.yaw = 0;
    cmd.flap = false;
    cmd.dive = false;
    cmd.brake = false;
    cmd.landPressed = false;
    cmd.rollLeftPressed = cmd.rollRightPressed = cmd.loopPressed = cmd.dropPressed = cmd.urgePressed = false;
    cmd.powerPressed = cmd.slipLeftPressed = cmd.slipRightPressed = false;
    if (sim.mode === 'grounded' || sim.mode === 'swimming' || sim.mode === 'underwater') {
      cmd.flapPressed = true;
      return;
    }
    if (sim.mode === 'hovering') {
      // Hovering: W (brake released) flies out.
      cmd.pitch = 1;
      return;
    }
    overrides.bankTarget = this.bankDeg * DEG;
    overrides.pathTarget = clamp((this.holdAltitude - y) * 0.012, -0.12, 0.16);
    overrides.airspeedTarget = null;
  }
}
