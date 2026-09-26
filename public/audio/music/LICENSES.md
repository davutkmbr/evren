# Music licences

Every music set and phrase in [`manifest.json`](manifest.json) is listed here once the owner has approved it
(CLAUDE.md, external assets). The manifest's `credit` and `approvedOn` fields carry the same data for the game's credits and
the moments source panel. How to prepare and add music: [`.docs/audio/music-system.md`](../../../.docs/audio/music-system.md).

## Sets

| Set id | Title | Author | Licence | Source | Approved |
| --- | --- | --- | --- | --- | --- |

No music set has been approved yet.

## Moment pieces from historic 78 rpm records

Restored excerpts of public-domain records (published before 1926, so free in the US; published and composed or
improvised by people who died more than 70 years ago, so free in Turkey). Approved by the owner on 2026-09-26
([decision](../../../.docs/assets/candidates/moment-music.md#decision-2026-09-26)); provenance, sha256 of every original
and the rights reasoning: [`.docs/assets/archive-78rpm.md`](../../../.docs/assets/archive-78rpm.md). Each piece exists
twice: `moments/<id>.opus` / `.m4a` (conservatively denoised: declick, gentle hiss reduction) and
`moments/<id>.raw.opus` / `.raw.m4a` (only trimmed, faded and loudness-matched, with the record's crackle); the
manifest's `variant` names the default. Rights holders' requests: `<contact-email>`.

| Piece id | Recording | Performers | Label, catalogue | Year | Excerpt | Source | Licence | Approved |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `kagithane-semaisi-1916` | Kâğıthane Semaisi (Käkidhana zemany), instrumental introduction | Karekin Proodian, Kemani Minas (violin), "Morene Eff." (kanun), Hagop (flute) | Victor 69173, matrix B-18808/2 | 1916 | 0:07.5–1:03.5 | [Library of Congress, National Jukebox](https://www.loc.gov/item/jukebox-20789/) | public domain | 2026-09-26 |
| `felek-bana-1916` | Felek Bana | Karekin Proodian, Kemani Minas and ensemble | Victor 69175, matrix B-18809/1 | 1916 | 0:01–1:56.5 | [Library of Congress, National Jukebox](https://www.loc.gov/item/jukebox-20790/) | public domain | 2026-09-26 |
| `aya-yorgi-apolitikiyonu-nafpliotis` | Os ton echmaloton eleftherotis (Apolytikion of St George) | Iakovos Nafpliotis | Orfeon, Constantinople | 1913–1918 | 0:00–1:15 (whole) | [analogion.com](https://analogion.com/site/html/Nafpliotis.html) | public domain | 2026-09-26 |

US-risky recordings (public domain in Turkey, protected in the US) are never in this folder: they live in the
gitignored `private-assets/audio/moments/` and reach players only inside builds
([`.docs/assets/private-assets.md`](../../../.docs/assets/private-assets.md)).
