/**
 * Writes the licence lists of the compiled street assets (CLAUDE.md: every integrated external asset is recorded):
 * - public/textures/LICENSES.md: texture sets and decals (approved.json kinds 'texture' / 'decal', and the public Poly
 *   Haven sets) that the compiled output uses;
 * - public/models/LICENSES.md: approved models (kind 'model') placed as props.
 * Sources: the `assets[]` credits of compiled index.json files, plus the texture sets that only procedural props use
 * (found through index.textures[] file names, `<set>_<role>.<ext>`), credited from tools/assets/approved.json and the
 * public set table. Each file keeps its hand-written part; the generated part sits between the GENERATED markers and
 * is replaced on every run. Deterministic (sorted, no timestamps).
 *
 *   npx tsx tools/world-compiler/src/street/licences.ts [public/world/<area>/index.json ...]   (default: every area)
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ROOT } from '../../lib/areas.mjs';
import type { AssetCreditRec, IndexManifest } from '../format';
import { approvedAssets, publicSets } from '../textures';

const START = '<!-- GENERATED:street-assets (tools/world-compiler/src/street/licences.ts) -->';
const END = '<!-- /GENERATED:street-assets -->';

type Credit = Omit<AssetCreditRec, 'usedBy'> & { usedBy: Set<string>; areas: Set<string> };

function indexFiles(args: string[]): string[] {
  if (args.length) {
    return args.map((a) => resolve(ROOT, a));
  }
  const dir = resolve(ROOT, 'public/world');
  return existsSync(dir)
    ? readdirSync(dir)
        .map((d) => resolve(dir, d, 'index.json'))
        .filter((f) => existsSync(f))
    : [];
}

function collect(files: string[]): Map<string, Credit> {
  const credits = new Map<string, Credit>();
  const add = (c: Omit<AssetCreditRec, 'usedBy'>, users: string[], area: string): void => {
    let known = credits.get(c.id);
    if (!known) {
      known = { ...c, usedBy: new Set(), areas: new Set() };
      credits.set(c.id, known);
    }
    users.forEach((u) => known!.usedBy.add(u));
    known.areas.add(area);
    if (c.conditions && !known.conditions) {
      known.conditions = c.conditions;
    }
  };
  const approved = approvedAssets();
  const publics = publicSets();
  for (const f of files) {
    const index = JSON.parse(readFileSync(f, 'utf8')) as IndexManifest;
    const area = f.split('/').slice(-2, -1)[0];
    for (const a of index.assets ?? []) {
      add(a, a.usedBy, area);
    }
    // Texture sets that no tile material uses (procedural props): credited from their source lists.
    for (const t of index.textures ?? []) {
      if (t.file.startsWith('prop_')) {
        continue;
      }
      const key = t.file.replace(/_(color|normal|orm)(_\d+)?\.(jpg|png)$/, '');
      if (credits.has(key)) {
        credits.get(key)!.areas.add(area);
        continue;
      }
      const a = approved.get(key);
      if (a) {
        const cond = a.conditions.length ? a.conditions.map((text) => ({ text, met: 'see assets-src conditions / the compiler' })) : undefined;
        add({ id: a.id, name: a.name, kind: a.kind, source: a.source, url: a.url, licence: a.licence, author: a.author, attribution: a.attribution, ...(cond ? { conditions: cond } : {}) }, ['props'], area);
      } else if (key.startsWith('ph_') && publics.has(key.slice(3))) {
        const p = publics.get(key.slice(3))!;
        add({ id: key, name: p.source, kind: 'texture', source: 'polyhaven', url: p.url, licence: 'CC0-1.0', author: 'Poly Haven', attribution: null }, ['props'], area);
      }
    }
  }
  return credits;
}

const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

function table(rows: Credit[], models: boolean): string {
  const head = models
    ? '| Asset | Source | Author | Licence | Conditions (how met) | Used by |\n| --- | --- | --- | --- | --- | --- |'
    : '| Asset | Kind | Source | Author | Licence | Conditions (how met) | Used by |\n| --- | --- | --- | --- | --- | --- | --- |';
  const lines = rows.map((c) => {
    const cond = c.conditions?.length ? c.conditions.map((k) => `${k.text} — ${k.met}`).join('<br>') : '–';
    const used = [...c.usedBy].sort().join(', ');
    const src = `[${cell(c.name)}](${c.url}) (${c.source})`;
    const lic = c.attribution ? `${c.licence}; attribution: ${cell(c.attribution)}` : c.licence;
    return models ? `| \`${c.id}\` | ${src} | ${cell(c.author)} | ${lic} | ${cell(cond)} | ${cell(used)} |` : `| \`${c.id}\` | ${c.kind} | ${src} | ${cell(c.author)} | ${lic} | ${cell(cond)} | ${cell(used)} |`;
  });
  return [head, ...lines].join('\n');
}

function writeSection(file: string, intro: string, body: string, header: string): void {
  const path = resolve(ROOT, file);
  mkdirSync(dirname(path), { recursive: true });
  const old = existsSync(path) ? readFileSync(path, 'utf8') : `${header}\n`;
  const section = `${START}\n\n${intro}\n\n${body}\n\n${END}`;
  const i = old.indexOf(START);
  const j = old.indexOf(END);
  const next = i >= 0 && j > i ? old.slice(0, i) + section + old.slice(j + END.length) : `${old.trimEnd()}\n\n${section}\n`;
  writeFileSync(path, next.endsWith('\n') ? next : `${next}\n`);
}

const files = indexFiles(process.argv.slice(2));
if (!files.length) {
  throw new Error('no compiled index.json found: run `npm run compile:world -- --area kadikoy` first');
}
const credits = [...collect(files).values()].sort((a, b) => a.id.localeCompare(b.id));
const areas = [...new Set(credits.flatMap((c) => [...c.areas]))].sort();
const textures = credits.filter((c) => c.kind !== 'model');
const models = credits.filter((c) => c.kind === 'model');
writeSection(
  'public/textures/LICENSES.md',
  `## Street layer textures and decals\n\nTexture sets and decals in the compiled street output (\`public/world/<area>/textures/\`), generated from the compiled \`index.json\` credits. Raw files are cached in \`assets-src/\` (\`tools/assets/approved.json\`); the compiler re-encodes them (\`tools/world-compiler/src/textures.ts\`).`,
  table(textures, false),
  '# Texture licences',
);
writeSection(
  'public/models/LICENSES.md',
  `## Street layer props\n\nApproved models placed as props in the compiled street output (\`public/world/<area>/props/\`), generated from the compiled \`index.json\` credits. Their LOD glbs (\`<id>.lod1.glb\`, \`<id>.lod2.glb\`) are decimated copies made by the compiler (meshoptimizer). Procedural props (\`st_*\`, \`fac_*\`, lamp masts, mannequins) are Evren's own work under the repository licence.`,
  table(models, true),
  '# Model licences\n\nEvery external model in the game, with its licence and source (CLAUDE.md: external assets).',
);
console.log(JSON.stringify({ indexes: files.length, areas, textures: textures.length, models: models.length }));
