#!/usr/bin/env node
/**
 * Keeps private-assets/ (licensed for use in the game, not for redistribution: CLAUDE.md, .docs/assets/private-assets.md)
 * the same on every machine and cloud session: the folder is a clone of the owner's private repository.
 *
 *   npm run private:pull              first run: turns the folder into a clone (files already there are kept; the
 *                                     repository's own come in); after that: fast-forward to the repository
 *   npm run private:push -- "message" commits every change in the folder (except build/, regenerated) and pushes
 *   npm run private:status            what changed locally, and how far behind / ahead of the repository
 *
 * The repository: EVREN_PRIVATE_REPO, default https://github.com/davutkmbr/seventeenskies-private.git. It must stay
 * private and only the owner may have access: anyone with access receives the files.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIR = join(ROOT, 'private-assets');
const REPO = process.env.EVREN_PRIVATE_REPO ?? 'https://github.com/davutkmbr/seventeenskies-private.git';
/** Regenerated from the sources by the tools (tools/humans/build_rider.py and friends): never pushed. */
const IGNORE = ['build/', '.DS_Store', '__MACOSX/', '*.tmp', ''].join('\n');

function git(args, opts = {}) {
  return execFileSync('git', ['-C', DIR, ...args], { stdio: opts.quiet ? 'pipe' : 'inherit', encoding: 'utf8' });
}

function isClone() {
  return existsSync(join(DIR, '.git'));
}

function pull() {
  mkdirSync(DIR, { recursive: true });
  if (!isClone()) {
    // Adopt the folder: a clone in place, keeping what is already here (a file the repository also has stays as it is
    // here and shows as a change; push it or check it out).
    git(['init', '-q', '-b', 'main']);
    git(['remote', 'add', 'origin', REPO]);
    git(['fetch', '-q', 'origin']);
    const hasMain = git(['ls-remote', '--heads', 'origin', 'main'], { quiet: true }).trim() !== '';
    if (hasMain) {
      git(['reset', '-q', 'origin/main']);
      // Files the repository has and this folder lacks.
      const missing = git(['ls-files', '--deleted'], { quiet: true }).split('\n').filter(Boolean);
      if (missing.length) {
        git(['checkout', '--', ...missing]);
      }
      git(['branch', '-q', '--set-upstream-to', 'origin/main']);
    }
    ensureIgnore();
    console.log(`[private-assets] ${DIR} now tracks ${REPO}`);
    status();
    return;
  }
  git(['pull', '-q', '--ff-only']);
  console.log('[private-assets] up to date with the repository');
}

function ensureIgnore() {
  const f = join(DIR, '.gitignore');
  if (!existsSync(f)) {
    writeFileSync(f, IGNORE);
  }
}

function push(message) {
  if (!isClone()) {
    pull();
  }
  ensureIgnore();
  git(['add', '-A']);
  const staged = git(['diff', '--cached', '--name-only'], { quiet: true }).trim();
  if (staged) {
    git(['commit', '-q', '-m', message || 'Update private assets']);
  }
  git(['push', '-q', '-u', 'origin', 'main']);
  console.log(staged ? `[private-assets] pushed:\n${staged}` : '[private-assets] nothing new; branch pushed');
}

function status() {
  if (!isClone()) {
    console.log('[private-assets] not a clone yet: npm run private:pull');
    return;
  }
  git(['fetch', '-q', 'origin']);
  git(['status', '--short', '--branch']);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'pull') {
  pull();
} else if (cmd === 'push') {
  push(rest.join(' '));
} else if (cmd === 'status') {
  status();
} else {
  console.log('usage: node scripts/private-assets.mjs pull | push [message] | status');
  process.exit(1);
}
