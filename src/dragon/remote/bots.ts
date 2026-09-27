/**
 * Test dragons without a server (`?bots=N`, DEV_TOOLS only): the local dragon's snapshots are recorded at the network
 * rate, encoded to bytes, and replayed a few seconds later by each bot with a formation offset (beside and behind the
 * recorded heading). Every snapshot goes through the real path: codec, SnapshotBuffer, interpolation, remote rig.
 */
import type { DragonPose, DragonState, RemoteDragonService } from '../../core/contracts';
import { captureSnapshot } from '../../net/capture';
import { createSnapshot, decodeSnapshot, encodeSnapshot, SNAPSHOT_BYTES } from '../../net/snapshot';

/** Network send rate (Hz), as planned for the game servers. */
export const SEND_RATE = 10;
const HISTORY_S = 90;

interface Recorded {
  t: number;
  bytes: ArrayBuffer;
}

interface Bot {
  id: string;
  delayMs: number;
  /** Formation offset in the recorded heading's frame: right (m), up (m), back (m). */
  right: number;
  up: number;
  back: number;
  /** Next history entry to send. */
  cursor: number;
}

export class SnapshotBots {
  private readonly history: Recorded[] = [];
  private readonly bots: Bot[] = [];
  private readonly scratch = createSnapshot();
  private readonly out = new ArrayBuffer(SNAPSHOT_BYTES);
  private lastCapture = -Infinity;

  constructor(
    count: number,
    private readonly service: RemoteDragonService,
  ) {
    for (let i = 0; i < count; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const row = Math.floor(i / 2) + 1;
      this.bots.push({ id: `bot-${i + 1}`, delayMs: 1500 + i * 400, right: side * 28 * row, up: 5 * (i % 3), back: 12 * row, cursor: 0 });
    }
  }

  update(state: DragonState, pose: Readonly<DragonPose>, now: number): void {
    if (now - this.lastCapture >= 1000 / SEND_RATE) {
      this.lastCapture = now;
      const bytes = encodeSnapshot(captureSnapshot(state, pose, now, this.scratch));
      this.history.push({ t: now, bytes });
      const drop = this.history.findIndex((r) => r.t >= now - HISTORY_S * 1000);
      if (drop > 0) {
        this.history.splice(0, drop);
        for (const b of this.bots) {
          b.cursor = Math.max(0, b.cursor - drop);
        }
      }
    }
    for (const b of this.bots) {
      while (b.cursor < this.history.length && this.history[b.cursor].t + b.delayMs <= now) {
        this.send(b, this.history[b.cursor]);
        b.cursor++;
      }
    }
  }

  /** The recorded snapshot, shifted to the bot's place in the formation and to the time it is "received". */
  private send(b: Bot, r: Recorded): void {
    const s = decodeSnapshot(r.bytes, 0, this.scratch);
    const [qx, qy, qz, qw] = s.quaternion;
    // Heading only (a roll or loop must not swing the formation): the dragon's forward (-Z) projected on the ground.
    const fx = -(2 * (qx * qz + qw * qy));
    const fz = -(1 - 2 * (qx * qx + qy * qy));
    const len = Math.hypot(fx, fz) || 1;
    const dx = fx / len;
    const dz = fz / len;
    // Right of forward on the ground: (-dz, dx).
    s.position[0] += -dz * b.right - dx * b.back;
    s.position[1] += b.up;
    s.position[2] += dx * b.right - dz * b.back;
    s.t = r.t + b.delayMs;
    this.service.push(b.id, encodeSnapshot(s, this.out));
  }
}
