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
manifest's `variant` names the default. Rights holders' requests: `davutkmbr@gmail.com`.

| Piece id | Recording | Performers | Label, catalogue | Year | Excerpt | Source | Licence | Approved |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `kagithane-semaisi-1916` | Kâğıthane Semaisi (Käkidhana zemany), instrumental introduction | Karekin Proodian, Kemani Minas (violin), "Morene Eff." (kanun), Hagop (flute) | Victor 69173, matrix B-18808/2 | 1916 | 0:07.5–1:03.5 | [Library of Congress, National Jukebox](https://www.loc.gov/item/jukebox-20789/) | public domain | 2026-09-26 |
| `felek-bana-1916` | Felek Bana | Karekin Proodian, Kemani Minas and ensemble | Victor 69175, matrix B-18809/1 | 1916 | 0:01–1:56.5 | [Library of Congress, National Jukebox](https://www.loc.gov/item/jukebox-20790/) | public domain | 2026-09-26 |
| `aya-yorgi-apolitikiyonu-nafpliotis` | Os ton echmaloton eleftherotis (Apolytikion of St George) | Iakovos Nafpliotis | Orfeon, Constantinople | 1913–1918 | 0:00–1:15 (whole) | [analogion.com](https://analogion.com/site/html/Nafpliotis.html) | public domain | 2026-09-26 |
| `isfahan-gazeli-cemil-bey` | Dil verme gönül, Isfahan gazeli | Mulla Osman al-Mawsili (Hâfız Osman, voice), Tanburi Cemil Bey (tanbur) | Istanbul 78 rpm (label not given) | c. 1912 | 0:00–1:40 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:%D9%85%D9%84%D8%A7_%D8%B9%D8%AB%D9%85%D8%A7%D9%86_%D8%A7%D9%84%D9%85%D9%88%D8%B5%D9%84%D9%8A_-_%D8%BA%D8%B2%D9%84_%D8%A7%D8%B5%D9%81%D9%87%D8%A7%D9%86_Isfahan_Gazel_-_Uthman_al-Mosuli.ogg) | public domain | 2026-09-26 |
| `resadiye-marsi-1910` | Reşadiye Marşı (Marche de Sa Majesté Impériale le Sultan Mohammed V) | Odeon Orchestra (Italo Selvelli, composer) | Odeon 54745 | 1910 | 0:00–1:30 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Marche_de_sa_Majest%C3%A9_Imp%C3%A9riale_Le_Sultan_Mohammed_V._par_Italo_Selvelli.ogg) | public domain | 2026-09-26 |

US-risky recordings (public domain in Turkey, protected in the US) are never in this folder: they live in the
gitignored `private-assets/audio/moments/` and reach players only inside builds
([`.docs/assets/private-assets.md`](../../../.docs/assets/private-assets.md)).
