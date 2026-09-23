# Evren — Project Rules

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
3. After approval, record every integrated asset in `public/models/LICENSES.md` or `public/textures/LICENSES.md`.

Already approved: the CC0 Poly Haven texture sets listed in `public/textures/LICENSES.md` and OpenStreetMap data
(ODbL, attribution shown in the UI).

## Shared machine (agents)

Several agents often work in parallel on one machine while the user plays the game.

- Take screenshots only with `scripts/snap.mjs` (batch several shots with `--batch`). It queues GPU browsers
  machine-wide and runs pages at 24 fps; do not launch your own Playwright/Chrome scripts.
- Use the shared dev server on port 5199; do not start additional Vite servers.
- Automated browsers run the game at 24 fps by default; add `?fps=0` (or use `snap.mjs --perf`) for performance numbers.
