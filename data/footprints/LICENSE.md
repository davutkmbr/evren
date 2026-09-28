# Data licence (data/footprints)

The building merge of the world compiler (`scripts/data/footprints-merge.ts`) adds building footprints and storey
estimates to the OpenStreetMap buildings of every layer (Galata slice, flight-scale regions, far-city bake, street
areas, the Unreal city). Its sources were approved by the owner on 2026-09-28 (research and decision:
seventeenskies-unreal `.docs/assets/candidates/building-footprints.md`; entries in `tools/assets/approved.json`). The raw
downloads live in `data/footprints-src/` (gitignored, fetched by `scripts/data/fetch-footprints.mjs`); the pinned
inputs with their checksums are recorded in [`sources.json`](sources.json), and the licence texts as downloaded in
[`licences/`](licences/).

| Source | Used for | Licence | Attribution |
|---|---|---|---|
| [Microsoft Global ML Building Footprints](https://github.com/microsoft/GlobalMLBuildingFootprints), release 2026-08-13, the level-9 tiles over the İstanbul province | Building footprints where OSM has none | [CDLA-Permissive-2.0](https://cdla.dev/permissive-2-0/) ([text](licences/CDLA-Permissive-2.0.txt)) | None required; courtesy credit "Building footprints: Microsoft Global ML Building Footprints (release 2026-08-13), CDLA-Permissive-2.0" |
| [İBB Açık Veri Portalı, Mahalle Bazlı Bina Sayıları](https://data.ibb.gov.tr/dataset/mahalle-bazli-bina-analiz-verisi) (2017) | Storey mix and building count per mahalle | [İBB Açık Veri Lisansı 1.0](https://data.ibb.gov.tr/en/license) ([text](licences/IBB-Open-Data-License-1.0.txt)) | "Contains public sector information from the İBB Açık Veri Portalı (Mahalle Bazlı Bina Sayıları), licensed under the İBB Açık Veri Lisansı (Istanbul Metropolitan Municipality Open Data Licence) 1.0." No endorsement by İBB is implied. |
| [GHS-BUILT-H R2023A](https://data.jrc.ec.europa.eu/dataset/85005901-3a49-48dd-9d19-6261354f56fe), ANBH, epoch 2018, 100 m, tile R5_C21 | Check of the estimated heights per 100 m cell; the cell mean where nothing else applies | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) ([copyright notice](licences/GHSL-copyright.txt)) | "GHS-BUILT-H R2023A, European Commission, Joint Research Centre, CC BY 4.0, doi:10.2905/85005901-3A49-48DD-9D19-6261354F56FE, modified." |
| [Copernicus Urban Atlas Building Block Height 2021](https://sdi.eea.europa.eu/catalogue/srv/api/records/c5215520-98e9-4035-be56-d28156cd4dcd) | Rooftop height per building (first height source after OSM tags) | [Copernicus data policy](https://land.copernicus.eu/en/data-policy) | **Pending**: the download needs the owner's Copernicus account. Once used: "Generated using European Union's Copernicus Land Monitoring Service information (Urban Atlas Building Block Height 2021, doi:10.2909/c5215520-98e9-4035-be56-d28156cd4dcd), modified." |

Turkish credit line (game): "Bina tabanları: Microsoft · Kat bilgisi: İBB Açık Veri, GHSL", next to "Harita verisi ©
OpenStreetMap katkıcıları (ODbL) · Yükseklik: NASA SRTM"; the full statements are in `CREDITS.md` and on the terms
page (`legal/terms.html`).

## The merged data (ODbL 4.6)

The merged building set is a Derivative Database of OpenStreetMap with additional contents, so it is released under the
same ODbL 1.0, © OpenStreetMap contributors, and published with the compiler:

- the layers' data (`public/data/osm/**`, `data/osm/*.json`) and the far-city bake, once fetched with the merge, carry
  the added footprints (`source: 'ml'`), the row lots (`source: 'lot'`) and the storey estimates (`levelsFrom`), with
  the merge stamp in `footprints`;
- [`microsoft-additions.csv.gz`](microsoft-additions.csv.gz): the Microsoft footprints the merge keeps in the playable
  square, as the compiler uses them (synthetic id, source tile, confidence, kind, WKT polygon in WGS 84), so the set
  stays reproducible when Microsoft no longer serves the release. Microsoft's footprints are shared under
  CDLA-Permissive-2.0 §2.1 with its text ([licences/CDLA-Permissive-2.0.txt](licences/CDLA-Permissive-2.0.txt)); every
  build that ships them includes that text too;
- [`ibb-mahalle.json`](ibb-mahalle.json): İBB's table joined to the OSM mahalle (derived, openly published, credited
  as above); [`ibb-aliases.json`](ibb-aliases.json): the renamed mahalle the join needs;
- [`coverage.md`](coverage.md): buildings per ilçe before and after the merge, against İBB's count.

Everything is regenerated from the pinned inputs: `npm run fetch:footprints`, `npm run merge:footprints`, then the layer
fetches and the bake (see `scripts/data/footprints-merge.ts`).
