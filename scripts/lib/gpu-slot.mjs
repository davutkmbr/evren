/**
 * Machine-wide queue for headless GPU browsers, shared by scripts/snap.mjs and scripts/walk-test.mjs (parallel agents
 * share one GPU while the user plays). Slots are lock directories under .shots/.snap-slots holding the owner's pid;
 * stale slots of dead processes are reclaimed. At most SNAP_MAX_CONCURRENT (default 2) browsers run at once.
 *
 *   import { chromium } from 'playwright-core';
 *   import { launchGpuBrowser, releaseSlot } from './lib/gpu-slot.mjs';
 *   const browser = await launchGpuBrowser(chromium);   // waits for a slot
 *   try { ... } finally { await browser.close(); releaseSlot(); }
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const MAX_CONCURRENT = Number(process.env.SNAP_MAX_CONCURRENT ?? 2);
export const LOCK_ROOT = fileURLToPath(new URL('../../.shots/.snap-slots', import.meta.url));
/** Headless system Chrome on the Metal ANGLE backend (real GPU). */
export const CHROME_ARGS = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'];

let heldSlot = null;

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function acquireSlot() {
  mkdirSync(LOCK_ROOT, { recursive: true });
  for (;;) {
    for (let i = 0; i < MAX_CONCURRENT; i++) {
      const dir = `${LOCK_ROOT}/slot-${i}`;
      try {
        mkdirSync(dir);
        writeFileSync(`${dir}/pid`, String(process.pid));
        heldSlot = dir;
        return;
      } catch {
        let owner = NaN;
        try {
          owner = Number(readFileSync(`${dir}/pid`, 'utf8'));
        } catch {
          /* being created */
        }
        if (Number.isFinite(owner) && owner > 0 && !alive(owner)) {
          rmSync(dir, { recursive: true, force: true });
        }
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

export function releaseSlot() {
  if (heldSlot) {
    rmSync(heldSlot, { recursive: true, force: true });
    heldSlot = null;
  }
}

process.on('exit', releaseSlot);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    releaseSlot();
    process.exit(130);
  });
}

/** Waits for a GPU slot, then launches headless Chrome with the shared flags. */
export async function launchGpuBrowser(chromium) {
  await acquireSlot();
  try {
    return await chromium.launch({ channel: 'chrome', headless: true, args: CHROME_ARGS });
  } catch (e) {
    releaseSlot();
    throw e;
  }
}
