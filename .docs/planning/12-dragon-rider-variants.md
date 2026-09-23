# Phase 12 — Dragon and rider variants

Milestone: E · Variety · Effort: M · Depends on: 01 (stronger with Phase 10)

## Goal

Choose between different dragons and different riders. Because the dragon is generated in code, many species can be
derived from the existing skeleton.

## Dragon variants

### Same anatomy, different parameters (cheap)
Via a `DragonSpec`: body and neck length, wingspan and wing shape, horn and spike sets, scale pattern, colour palette,
membrane translucency, eye colour, fire colour.

| Species | Character |
|---|---|
| Obsidian | Current: dark body, ember-coloured belly |
| Bosphorus Copper | Bronze scales, turquoise membrane, wide wings, a natural glider |
| Snow White | Pale scales, ice-blue eyes, pairs with ice breath |
| Night Blue | Deep navy, bioluminescent veins (glow at night) |
| Crimson Storm | Red, spiky, fast and agile; a smaller body |

### Different anatomy (expensive)
- Wyvern (wing-arms instead of front legs); walks on its wing wrists on the ground.
- Eastern serpentine dragon: wingless, "swims" through the air; its own skeleton, animation and flight model.

Flight parameters change per species too: mass, wing area, stamina, top speed and agility.

## Rider variants

- Body (height, build), outfit set (hooded traveller, armoured knight, light pilot, kaftan-inspired traditional), colours,
  accessories (cloak, scarf, goggles).
- Saddle and harness variants (leather, silver-engraved, racing saddle).

## UI

- "Stable" screen: dragon and rider selection, 3D preview (slowly rotating model, sunset lighting), stat bars.
- Unlockables: some species and outfits unlock through discoveries and bond level (Phases 06 and 13).
- The selection persists (`localStorage`); in multiplayer it is sent to other players (Phase 15).

## Technical approach

- The model generator becomes parametric and takes a `DragonSpec`; texture generation derives from the palette.
- Generation results are cached per spec (IndexedDB) so startup time does not grow.
- Flight: a parameter table per species (extend `src/dragon/flight/params.ts`).
- Wyvern and Eastern dragon are treated as separate sub-phases.

## Acceptance criteria

- At least 5 dragon species and 4 rider sets, each approved with screenshots.
- Switching species takes < 1 s without a page reload.
- Flight feel differs noticeably between species (speed, turning and glide measured with `scripts/flight-test.mjs`).
