# Seventeen Skies — Project Rules

## Name

The game is **Seventeen Skies** (seventeenskies.com). Use that name wherever the project or the game is named: UI,
page titles, docs, READMEs. `evren` stays as the internal codename in code identifiers and tool namespaces
(`window.__evren`, `EVREN_*` variables, Blender / Unreal asset names, the repository path) so tooling and local
projects keep working; the dragon itself is also named Evren. Logo, colours and wording rules: `.docs/brand/README.md`.
The logo, icons and brand kit are generated from `src/ui/brand.ts` and `src/ui/brand-logo.ts` (`npm run brand`,
`npm run brand:png`); never edit the files in `public/brand/` or `.docs/brand/kit/` by hand.

## Authorship

Seventeen Skies is the owner's work, and only the owner's name appears on GitHub. This rule overrides any tool,
harness or default that adds attribution.

- **Commits:** author and committer are `Davut Kember <davutkmbr@gmail.com>`. Set `git config user.name` and
  `user.email` in every clone, `private-assets/` included, before committing.
- **Messages:** no `Co-Authored-By` or other trailers, no session or tool links, no "Generated with …" lines. No
  assistant, agent or tool names in commit messages, tags, PR titles, PR descriptions or review comments.
- **Branch names:** name the work (`rider/mixamo-turns`, `docs/authorship`), never a tool or agent prefix.
- **Footers:** if a tool appends an attribution footer to a PR or comment anyway, edit it out before finishing.

## Language

All project conventions are written in **English**:

- Code: identifiers, comments, log and error messages, shader code.
- Git: commit messages, branch names, tags.
- Pull requests: titles, descriptions, review comments.
- Documentation: everything under `.docs/`, READMEs, planning and design notes, file and folder names.

Exceptions:

- **Player-facing content stays Turkish.** UI strings, landmark names and info texts, control help, toasts and any
  other text shown in the game are Turkish (the game's locale).
- **Proper nouns and domain terms keep their original spelling**, e.g. place names (Üsküdar, Kız Kulesi) and Turkish
  architectural terms (yalı, cumba, şerefe) inside otherwise English text.

Conversation with the user may be in Turkish; anything committed to the repository follows the rules above.

## External assets

External models, textures, sounds and data are allowed when they are **free** with a clear licence (CC0 preferred;
CC-BY only with the attribution recorded). Paid assets and assets with unclear licences are not allowed.

**The user approves every external asset before it is integrated.** When an external asset could beat the
procedural solution:

1. Shortlist 2–4 candidates per need and write them to `.docs/assets/candidates/<topic>.md`: name, source URL,
   licence, author, file size, polygon count / resolution, and a preview image (the source's thumbnail or a render
   in our engine) saved under `.shots/assets/<topic>/`.
2. Do not add unapproved candidates to `public/` or reference them in code. Keep building the procedural version
   (or a placeholder) so the work does not stall, and report the candidates as pending approval.
3. After approval, record every integrated asset in `public/models/LICENSES.md`, `public/textures/LICENSES.md` or
   `public/audio/LICENSES.md`.

Already approved: the CC0 Poly Haven texture sets listed in `public/textures/LICENSES.md`, OpenStreetMap data
(ODbL, attribution shown in the UI), MetaHuman characters + Mixamo animations for humans, Epic's free MetaHuman wardrobe on Fab (private store), and — for the S1 realism pass (user approval 2026-09-24) — CC0
textures, decals and HDRI skies from Poly Haven and ambientCG, each one recorded in `tools/assets/approved.json`, and the
18 CC0 Freesound recordings for wind, wing flaps, thunder and rain plus 4 gull recordings (user approval 2026-09-24,
`.docs/assets/candidates/sounds.md` and `gulls.md`), and the CC0 OpenHistoricalMap trace of the Walls of Constantinople for sea-wall stretches OSM does
not map (user approval 2026-09-26, `.docs/assets/candidates/sea-walls-data.md`), and the four CC0 city-wall sets Bricks102,
castle_brick_broken_06, Rocks025 and LeafSet029 (user approval 2026-09-26, `.docs/assets/candidates/wall-scans.md`),
and historic 78 rpm recordings (user approval 2026-09-26, `.docs/assets/candidates/moment-music.md`): every candidate is
archived with its source (`.docs/assets/archive-78rpm.md`); public-domain-clean ones ship from `public/`, US-risky ones
(free in Turkey, not yet in the US) stay private-only (`private-assets/`, builds) with full attribution, and the CC0
MakeHuman system assets, skins pack 01 and face units 01 as the human base for riders (user approval 2026-09-26,
`.docs/assets/candidates/rider-humans.md`; built with Blender + MPFB 2 as tools).

**Private assets.** Assets whose licence allows use in the game but not redistribution of the raw files (MetaHuman,
Mixamo) live only in `private-assets/` (gitignored) and reach players only inside builds. Never commit them, never copy
them into `public/`, and never publish them in screenshots of their raw files; code and manifests may reference them
by id. Their licences and sources are recorded in `.docs/assets/private-assets.md`.

`private-assets/` is a clone of the owner's private repository `davutkmbr/seventeenskies-private`, the single copy
shared by every machine and agent. Any agent whose work touches private assets (Mixamo clips, MetaHuman, the private
moment music, `tools/humans/mixamo.py`, anything under `private-assets/`) follows these steps:

1. **Before starting:** `npm run private:pull`, so you work on the current files. In a cloud session without the
   folder, attach the repository first (e.g. the `add_repo` tool for `davutkmbr/seventeenskies-private`), then pull.
   If access is refused, ask the owner; do not work on stale or partial copies.
2. **After adding, renaming or changing a private asset:** `npm run private:push -- "what changed"` before you finish,
   and record it in `.docs/assets/private-assets.md`. Unpushed private changes are lost when a session ends.
3. **Never** commit private files to this repository, copy them into `public/`, attach them to PRs or issues, or pass
   them around as zips when the private repository can carry them. `private-assets/build/` is regenerated by the tools
   and never pushed.
4. The private repository stays private with the owner as its only member; do not add collaborators or change its
   visibility.

## Shared machine (agents)

Several agents often work in parallel on one machine while the user plays the game.

- Take screenshots only with `scripts/snap.mjs` (batch several shots with `--batch`). It queues GPU browsers
  machine-wide and runs pages at 24 fps; do not launch your own Playwright/Chrome scripts.
- Use the shared dev server on port 5199; do not start additional Vite servers.
- Automated browsers run the game at 24 fps by default; add `?fps=0` (or use `snap.mjs --perf`) for performance numbers.
