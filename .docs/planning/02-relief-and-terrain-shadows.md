# Phase 02 — Realistic relief and terrain shadows

Milestone: A · Hardening · Effort: M · Depends on: 01

## Goal

Istanbul is the "city of seven hills", but in the game almost everything looks flat. Hills and slopes must read like the
real city, both in the data and on screen.

## Diagnosis (measured 23 September 2026)

Measured in the running app with `geo.heightAt`. Terrain heights are rendered 1:1; there is no vertical scaling.

| Point | In game | Real | Status |
|---|---|---|---|
| Büyük Çamlıca | 271 m | 268 m | Correct |
| Küçük Çamlıca | 228 m | 229 m | Correct |
| Seven hills (Süleymaniye, Fatih, Sultan Selim, Edirnekapı, Beyazıt…) | 52–75 m | 40–75 m | Correct |
| Taksim | 84 m | ~80 m | Correct |
| Kayışdağı | 240 m | 438 m | **Too low** |
| Aydos | 429 m | 537 m | **Too low** |
| Yuşa Tepesi | measurement doubtful | 201 m | Verify coordinates |
| Alibeyköy and Elmalı reservoirs | pit at sea level | 30–60 m lake surface | **Wrong** |

Why it looks flat:
1. **No hill shadows:** The shadow map covers about 2 km; in the evening sun distant hills cast no shadows.
2. **Steep slopes were smoothed:** The 23 m grid plus spline smoothing flattens steep shore slopes such as Cihangir,
   Rumeli Hisarı and the Bosphorus banks. Those steep slopes are what make Istanbul look hilly. The data is 15 m RMS off
   SRTM, with 325–460 m point spacing.
3. **No slope shading on the ground:** The city carpet texture and haze hide the relief.
4. **Removed valleys:** Maçka–Dolmabahçe, Kuzguncuk, Beykoz, Cibali and Çarşamba–Balat were deleted because they were misplaced.

## Scope

### Data (geo)
- Kayışdağı, Aydos, Alemdağ and Yuşa at their real heights and ridge directions; ridge lines instead of isolated cones.
- Real slopes on the Bosphorus and Golden Horn banks: rising to 80–150 m within 300–500 m of the shore.
- Redraw the five removed valleys by hand from SRTM cross-sections.
- Denser height points in the Bosphorus band (target < 8 m RMS).
- Inland lakes: `GeoQuery.waterLevelAt(x, z)` or a lake list; the water module renders raised lake surfaces and the 30–60 m pits disappear.

### Rendering (terrain + sky)
- Large-scale terrain shadows: a horizon/shadow map precomputed for the sun direction (updated incrementally as the sun
  moves 0.5°). At sunset hills cast shadows into valleys.
- Slope and curvature shading: ridges slightly brighter, valleys darker (ambient-occlusion-like).
- Buildings sit stepped on slopes (city module): foundations reach down to the lowest ground, roof lines follow the slope.
- No artificial vertical exaggeration; it would break realism.

## Acceptance criteria

- Every point in the table within ±5% of the real value.
- In `?view=camlica&t=18.8`, `?view=halic` and `?view=bogaz` screenshots, hills and valleys read clearly through shadows.
- Seen from the Bosphorus shore (Bebek, Rumeli Hisarı), the slopes look steep.
- Reservoirs show as lake surfaces, no pits.
- Performance: terrain shadows ≤ 0.5 ms GPU, CPU ≤ 0.2 ms/frame on average.

## Technical notes

- Modules touched: `src/world/geo/data/relief.ts`, `spot-heights.ts`, `rivers.ts`; `src/world/terrain` (shadow and
  shading shaders); `src/world/water` (lake surfaces); `src/world/city` (stepped placement).
- Contract: `GeoQuery.waterLevelAt` (or `lakes`).
- Collision: `CollisionWorld.groundHeight` must account for lake surfaces.
