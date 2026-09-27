/**
 * Public API of the HUD zones, shared by src/ui and src/activities (activities import only from here).
 * Zone model and priorities: .docs/design/README.md, section 3.
 */
export { HUD_PRIORITY, HUD_ZONES, HudDirector, ZONE_FADE_GAP_S, type HintItem, type HintLineState } from './director';
export { applyZoneBands, zoneBands, type Band, type ZoneBands } from './bands';
export { fadeBinding, hintRow, HintLineView, ZONE_CLASS } from './view';
export { hintKeys, onPadHints, padHints, padLayout, setPadHints } from './key-device';
