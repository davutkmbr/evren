# Sea-wall course data candidates

Status: shortlist only. Nothing from these sources is in `public/`, in `src/`, or referenced by default code paths.
`scripts/data/fetch-walls.mjs --supplement <id>` refuses to run until the source has an approved entry (kind `data`)
in `tools/assets/approved.json`. Checked live on 2026-09-26.

## Need

The walls module (`src/world/landmarks/walls`) builds every city wall mapped in OpenStreetMap (approved source). OSM
maps the Theodosian land walls, Yedikule, Sur-ı Sultani, the Sarayburnu/Ahırkapı sea walls, Bukoleon, the Blachernae
walls at Ayvansaray, the Galata remnants and Anadolu Hisarı in detail, but **not** the course of the Marmara sea walls
between Yedikule and Ahırkapı (Samatya, Davutpaşa, Yenikapı, Kumkapı, Çatladıkapı: only fragments) nor the Golden
Horn walls between Ayvansaray and Eminönü (Balat, Fener, Cibali, Unkapanı: none). A generic generator cannot build a
wall that is not in its data, so these stretches need a second source for the wall line.

Preview: `.shots/assets/sea-walls/ohm-vs-osm.png` (red: OSM walls and towers, blue: the OHM candidate trace) and
`.shots/assets/sea-walls/osm-only.png` (everything wall-related OSM has in the peninsula).

## Candidates

| id | Source | Licence | Author | Size | Resolution | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `ohm-walls-constantinople` (recommended) | [OpenHistoricalMap way 198283607](https://www.openhistoricalmap.org/way/198283607) "Walls of Constantinople" (`barrier=city_wall`, `start_date=0413`), queried via `https://overpass-api.openhistoricalmap.org/api/interpreter` | CC0 1.0 ([OHM copyright](https://www.openhistoricalmap.org/copyright); the way has no `license=*` override) | OpenHistoricalMap contributors | ~12 KB JSON | 155 nodes over 19.2 km (one vertex per ~125 m): the full land + sea circuit | Coarse but follows the whole Marmara and Golden Horn course. Only the stretches farther than 40 m from any OSM wall are used, so OSM keeps priority wherever it maps the wall. |
| `ohm-walls-blachernae` | [OpenHistoricalMap way 201877673](https://www.openhistoricalmap.org/way/201877673) (`start_date=0413`, 29 nodes, 5 km) | CC0 1.0 | OpenHistoricalMap contributors | ~3 KB | ~170 m per vertex | Alternative course near Blachernae; mostly covered by OSM already. |
| (not recommended) Wikidata gate / tower coordinates | Wikidata items of the sea-wall gates (Kumkapı, Samatya Kapısı, Balat Kapısı, ...) | CC0 1.0 | Wikidata contributors | small | points only | Points, not a line; would need interpolation along the coast, which is guesswork. |

Excluded: OHM way 201877686 ("Constantinian walls", 336) — the 4th-century wall is gone.

## Recommendation

Approve `ohm-walls-constantinople`. Integration after approval: add the entry to `tools/assets/approved.json` with
`"kind": "data"`, `"endpoint": "https://overpass-api.openhistoricalmap.org/api/interpreter"` and
`"query": "[out:json][timeout:120];way(198283607);out tags geom;"`, run
`node scripts/data/fetch-walls.mjs --supplement ohm-walls-constantinople`, and credit it in the data licence notes.
The supplemented stretches go through the same generic rules as OSM lines (openings at roads, railways and buildings,
no wall over water, generated towers every ~62 m), so where the modern city has built over the old course (Eminönü,
Unkapanı) the wall stays open.

## Decision (2026-09-26)

The user approved `ohm-walls-constantinople` (CC0 1.0). It is recorded in `tools/assets/approved.json` (kind `data`)
and fetched with `node scripts/data/fetch-walls.mjs --supplement ohm-walls-constantinople`. The other candidates are
not approved.
