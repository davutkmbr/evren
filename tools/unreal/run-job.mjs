#!/usr/bin/env node
/**
 * Runs a Python job inside the open Unreal editor through the file-based job runner (tools/unreal/init_unreal.py).
 *
 *   node tools/unreal/run-job.mjs path/to/job.py [--project <dir>] [--timeout 600]
 *
 * Prints the job's JSON result ({ ok, stdout, error, result }) and exits 1 when the job failed or timed out.
 */
import { copyFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const job = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!job) {
  console.error('usage: run-job.mjs <job.py> [--project <dir>] [--timeout <s>]');
  process.exit(2);
}
const project = resolve(opt('project', join(ROOT, 'private-assets/unreal/EvrenHumans')));
const timeoutMs = Number(opt('timeout', '600')) * 1000;
const name = `${Date.now()}-${basename(job)}`;
const inbox = join(project, 'Jobs/inbox');
const outFile = join(project, 'Jobs/outbox', name.replace(/\.py$/, '.json'));
if (!existsSync(inbox)) {
  console.error(`no job inbox at ${inbox}: is the editor open with tools/unreal/init_unreal.py installed?`);
  process.exit(2);
}
copyFileSync(resolve(job), join(inbox, name));
const t0 = Date.now();
while (!existsSync(outFile)) {
  if (Date.now() - t0 > timeoutMs) {
    rmSync(join(inbox, name), { force: true });
    console.error(`timed out after ${timeoutMs / 1000} s (is the editor open and responsive?)`);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 300));
}
const result = JSON.parse(readFileSync(outFile, 'utf8'));
console.log(JSON.stringify(result, null, 1));
process.exit(result.ok ? 0 : 1);
