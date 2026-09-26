/**
 * `--check`: compiles the same area again in a child process, serially and without the cache (`--jobs 1 --cache
 * off`), into a temporary folder and compares both outputs file by file. The parallel and cached paths promise
 * byte-identical output; any difference is listed (summary `check`) and fails the run.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';

function files(dir: string, out: string[] = [], root = dir): string[] {
  for (const e of existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      files(p, out, root);
    } else {
      out.push(relative(root, p));
    }
  }
  return out.sort();
}

export interface CheckResult {
  identical: boolean;
  files: number;
  /** Files whose bytes differ, then files only one side has (first 20 of each). */
  differ: string[];
  onlyHere: string[];
  onlySerial: string[];
  serialMs: number;
}

export async function checkAgainstSerial(outDir: string, args: readonly string[]): Promise<CheckResult> {
  const root = mkdtempSync(join(tmpdir(), 'evren-check-'));
  const serialOut = join(root, basename(outDir));
  const drop = new Set(['--out', '--jobs', '--cache']);
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (drop.has(args[i])) {
      i++;
    } else if (args[i] !== '--check' && args[i] !== '--force') {
      rest.push(args[i]);
    }
  }
  const t = performance.now();
  const run = spawnSync(process.execPath, [...process.execArgv, process.argv[1], ...rest, '--out', serialOut, '--jobs', '1', '--cache', 'off'], { encoding: 'utf8', maxBuffer: 1 << 30 });
  const serialMs = Math.round(performance.now() - t);
  try {
    if (run.status !== 0 && !existsSync(join(serialOut, 'index.json'))) {
      throw new Error(`serial check compile failed (${run.status}): ${run.stderr.slice(-2000)}`);
    }
    const here = files(outDir);
    const there = new Set(files(serialOut));
    const differ: string[] = [];
    const onlyHere: string[] = [];
    for (const f of here) {
      if (!there.has(f)) {
        onlyHere.push(f);
      } else if (!readFileSync(join(outDir, f)).equals(readFileSync(join(serialOut, f)))) {
        differ.push(f);
      }
      there.delete(f);
    }
    const onlySerial = [...there];
    return { identical: !differ.length && !onlyHere.length && !onlySerial.length, files: here.length, differ: differ.slice(0, 20), onlyHere: onlyHere.slice(0, 20), onlySerial: onlySerial.slice(0, 20), serialMs };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
