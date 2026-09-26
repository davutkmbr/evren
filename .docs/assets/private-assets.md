# Private assets

Assets whose licence allows use inside the game but forbids redistributing the raw files. They live in
`private-assets/` (gitignored), are never committed or copied into `public/`, and reach players only inside builds.

| Source | Use | Licence | Notes |
|---|---|---|---|
| MetaHuman (Epic Games) | Player, hero NPCs, crowd (low LODs); faces via MetaHuman Animator | MetaHuman licence / Unreal Engine EULA: free under $1 M annual revenue, usable in any engine since mid-2025, no royalty outside Unreal | Characters are created in the Unreal Engine MetaHuman plugin and exported once. |
| Fab: Epic MetaHuman wardrobe | Crowd and NPC clothing (garments, shoes, construction presets) | Fab Standard License, Professional tier ($0): any engine; no standalone distribution; restrict extraction by end users | Added via Fab "Add to Project" in the Unreal project; approved 2026-09-24 (`.docs/assets/candidates/metahuman-outfits.md`). |
| Mixamo (Adobe) | Body animation clips, retargeted to the MetaHuman skeleton with Unreal's IK Retargeter (batch, Python) | Mixamo FAQ: royalty-free in games; raw files must not be redistributed | Downloaded "without skin" per clip. |
| Historic 78 rpm recordings, US-risky (Internet Archive, Gallica / BnF) | Moment pieces (music under moments) | Public domain in Turkey (published before 1956; composers and improvising performers died before 1956), **still protected in the US** (published 1926 or later, 17 U.S.C. §1401). Kept out of the public repository so it does not redistribute them; the owner accepts the residual risk (2026-09-26) | Full attribution below and in [archive-78rpm.md](archive-78rpm.md). Takedown requests: `<contact-email>`. |

## Layout

```
private-assets/
  unreal/EvrenHumans/         Unreal 5.8 project (MetaHuman Creator, Animator, IK Retargeter, exports)
  metahuman/<character-id>/   exported characters (source) + runtime LOD exports
  mixamo/<clip>.fbx           source clips (without skin)
  build/                      retargeted, packed runtime files (per runtime)
  audio/moments/              processed US-risky moment pieces: <id>.opus / .m4a (default) and <id>.raw.opus / .raw.m4a,
                              plus manifest.json (same format as public/audio/music/manifest.json, src paths "private/…")
```

The raw originals of these recordings are in the gitignored `assets-src/audio/78rpm/<id>/` like every archived 78
(`node scripts/data/fetch-assets.mjs --kind=recording --no-docs` re-downloads them and checks their sha256); the
moment pieces are rebuilt with `python3 scripts/audio/prep-moment-music.py` (target `private` in
`tools/assets/moment-pieces.json`).

## How private assets reach builds

- **Music (US-risky historic recordings).** `vite.config.ts` serves `private-assets/audio/moments/` at
  `/audio/music/private/` on the dev server and copies its `.opus`, `.m4a` and `manifest.json` files to
  `dist/audio/music/private/` at the end of `vite build`, when the folder exists. The game loads
  `audio/music/private/manifest.json` next to the public manifest and merges its phrases (`mergePrivatePhrases` in
  `src/audio/music/manifest.ts`: only `private/…` files, never replacing a public id; the public manifest rejects
  `public-domain-tr` pieces and `private/` paths). A checkout or build without the folder simply lacks those pieces: a
  moment that names one (`musicId`) falls back to the mood choice. `EVREN_PRIVATE_ASSETS=0` leaves them out of a dev
  server or build, e.g. for a build that is published openly.
- **MetaHuman / Mixamo.** Exported runtime files under `build/` (per runtime), wired when the human pipeline lands.

## US-risky moment pieces (full attribution)

| Piece | Recording | Performers | Label, catalogue / matrix | Year | Archive | US status | Moments |
|---|---|---|---|---|---|---|---|
| `katibim-safiye-ayla-1949` | Kâtibim (Üsküdar'a Gider İken), 0:00.5–1:39 | Safiye Ayla, with violin, kanun, ud and clarinet | 78 rpm (label not stated by the upload) | 1949 | [Internet Archive](https://archive.org/details/KatibimuskudaraGiderIken-SafiyeAyla) | protected until 1 Jan 2060 | `katibim-uskudar-yagmur` |
| `huseyni-taksim-hafiz-kemal` | Hüseyni Taksim (side 1), 0:00–1:27 | Hafız Kemal Bey (kemençe, 1884–1939) | Pathé, matrix N 11016 | c. 1927–1928 | [Gallica / BnF](https://gallica.bnf.fr/ark:/12148/bpt6k1310275k) (Archives de la Parole, AP-3029) | protected until 1 Jan 2028 or 2029 | `sinan-turbe-kitabesi` |
| `huzzam-taksim-resad-bey` | Hüzzam Taksim (side 2), 0:00.4–1:21 | Reşad Bey (violin) | Pathé, matrix N 11136 | c. 1927–1928 | [Gallica / BnF](https://gallica.bnf.fr/ark:/12148/bpt6k13102426) (Archives de la Parole, AP-2995) | protected until 1 Jan 2028 or 2029 | `hasim-bir-gunun-sonunda-arzu`, `kiz-kulesi-legend` |

Gallica files carry the BnF reuse conditions (credit "Source gallica.bnf.fr / BnF"; commercial reuse needs a BnF
licence). The other US-risky recordings (the rest of the Pathé discs, the Darülelhan and Hafız Burhan sides) are
archived only; see [archive-78rpm.md](archive-78rpm.md). Takedown contact for all of them: `<contact-email>`.

## Log

| Date | Asset | Source | Added by |
|---|---|---|---|
| 2026-09-26 | US-risky 78 rpm moment pieces `katibim-safiye-ayla-1949`, `huseyni-taksim-hafiz-kemal`, `huzzam-taksim-resad-bey` (owner approval 2026-09-26) | Internet Archive; Gallica / BnF | Claude (archive-78rpm pass) |
