/**
 * Details-layer policy read by other modules (kept free of three.js imports).
 * OWNS_PARK_TREES: set to true once this layer plants park / garden vegetation itself; the vegetation system then
 * removes its procedural park, forest and cemetery trees inside the OSM area as well (urban and street trees are
 * always removed there). Re-exported as OSM_OWNS_PARK_TREES by ../area.ts.
 */
export const OWNS_PARK_TREES = true;
