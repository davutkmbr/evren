#!/usr/bin/env node
/**
 * Runs one headless Blender job the shared-machine way: inside the machine-wide GPU slot (scripts/lib/gpu-slot.mjs,
 * the same queue snap.mjs uses), under `nice`, with a thread cap and a timeout, and always exits cleanly (the slot
 * is released and a hung Blender is killed). Every Blender job of the street track goes through this script.
 *
 *   node scripts/blender-run.mjs [options] <script.py> [-- <script args>]
 *     --timeout <s>     kill Blender after this many seconds (default 900); exit code 124
 *     --threads <n>     Blender render / bake threads (-t, default 4)
 *     --nice <n>        niceness (default 10)
 *     --blender <path>  Blender binary (default $BLENDER or /Applications/Blender.app/Contents/MacOS/Blender)
 *     --blend <file>    open this .blend first (default: none, factory startup)
 *     --no-slot         do not wait for a GPU slot (CPU-only jobs such as file inspection)
 *     --quiet           only print Blender's output when it fails
 *
 * Blender runs as `-b --factory-startup -noaudio --python-exit-code 1 -t <n> [file.blend] -P <script> -- <args>`, so a
 * Python exception fails the job. Inside the script, `sys.argv[sys.argv.index('--') + 1:]` are the script args and
 * the environment has EVREN_ROOT (the repository root).
 * Prints a JSON line at the end: { ok, code, seconds, waitedSeconds, script }.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireSlot, releaseSlot } from './lib/gpu-slot.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const dd = argv.indexOf('--');
const own = dd >= 0 ? argv.slice(0, dd) : argv;
const scriptArgs = dd >= 0 ? argv.slice(dd + 1) : [];
const opt = (name, def) => {
  const i = own.indexOf(`--${name}`);
  return i >= 0 ? own[i + 1] : def;
};
const flag = (name) => own.includes(`--${name}`);
const valued = new Set(['--timeout', '--threads', '--nice', '--blender', '--blend']);
const positional = own.filter((a, i) => !a.startsWith('--') && !valued.has(own[i - 1]));
const script = positional[0];
if (!script) {
  console.error('usage: node scripts/blender-run.mjs [--timeout s] [--threads n] [--nice n] [--blend file] [--no-slot] [--quiet] <script.py> [-- args]');
  process.exit(2);
}
const scriptPath = resolve(process.cwd(), script);
if (!existsSync(scriptPath)) {
  console.error(`blender-run: no such script ${scriptPath}`);
  process.exit(2);
}
const BLENDER = opt('blender', process.env.BLENDER ?? '/Applications/Blender.app/Contents/MacOS/Blender');
if (!existsSync(BLENDER)) {
  console.error(`blender-run: Blender not found at ${BLENDER}`);
  process.exit(2);
}
const timeoutS = Number(opt('timeout', 900));
const threads = Math.max(1, Number(opt('threads', 4)));
const niceness = Number(opt('nice', 10));
const blend = opt('blend', null);
const quiet = flag('quiet');

let child = null;
let killedForTimeout = false;
/* Never leave Blender running when this process goes away (gpu-slot.mjs exits on SIGINT / SIGTERM). */
process.on('exit', () => {
  if (child && child.exitCode === null) {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
});

const tWait = performance.now();
if (!flag('no-slot')) {
  await acquireSlot();
}
const waited = (performance.now() - tWait) / 1000;
const t0 = performance.now();
const blenderArgs = ['-b', '--factory-startup', '-noaudio', '--python-exit-code', '1', '-t', String(threads), ...(blend ? [resolve(process.cwd(), blend)] : []), '-P', scriptPath, '--', ...scriptArgs];
const out = [];
child = spawn('nice', ['-n', String(niceness), BLENDER, ...blenderArgs], {
  cwd: ROOT,
  env: { ...process.env, EVREN_ROOT: ROOT },
  stdio: ['ignore', 'pipe', 'pipe'],
});
for (const stream of [child.stdout, child.stderr]) {
  stream.on('data', (chunk) => {
    if (quiet) {
      out.push(chunk);
    } else {
      process.stdout.write(chunk);
    }
  });
}
const timer = setTimeout(() => {
  killedForTimeout = true;
  console.error(`blender-run: timeout after ${timeoutS} s, stopping Blender`);
  child.kill('SIGTERM');
  setTimeout(() => child.exitCode === null && child.kill('SIGKILL'), 10000).unref();
}, timeoutS * 1000);

const code = await new Promise((res) => {
  child.on('error', (e) => {
    console.error(`blender-run: ${e.message}`);
    res(1);
  });
  child.on('close', (c, sig) => res(c ?? (sig ? 128 : 1)));
});
clearTimeout(timer);
releaseSlot();
const exitCode = killedForTimeout ? 124 : code;
if (quiet && exitCode !== 0) {
  process.stdout.write(Buffer.concat(out));
}
console.log(JSON.stringify({ ok: exitCode === 0, code: exitCode, seconds: Math.round((performance.now() - t0) / 100) / 10, waitedSeconds: Math.round(waited * 10) / 10, script: scriptPath }));
process.exit(exitCode);
