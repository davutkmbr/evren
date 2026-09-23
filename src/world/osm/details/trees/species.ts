/** Tree species planted by the details layer (shared by the worker placement and the main-thread models). */

/**
 * - plane: çınar (Platanus orientalis), the broad crowns of squares, parks and mosque yards; also stands in for the
 *   limes, horse chestnuts and fig trees of courtyards (per-instance scale and tint).
 * - cypress: servi, dark columns of mosque yards and cemeteries.
 * - pine: fıstık çamı (stone pine), umbrella crowns of the larger parks and the Sarayburnu slopes.
 * - palm: Canary date palms of the seafront promenades.
 */
export const TREE_SPECIES = ['plane', 'cypress', 'pine', 'palm'] as const;
export type TreeSpecies = (typeof TREE_SPECIES)[number];
