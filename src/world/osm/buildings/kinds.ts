/** building=* kind sets shared by the layers (kept free of imports so workers can take them alone). */

/** building=* values that are not solid buildings. */
export const NON_SOLID_KINDS: ReadonlySet<string> = new Set(['ruins', 'collapsed', 'bridge', 'construction', 'no']);
/** building=* values drawn as canopies up close and left out from the air. */
export const CANOPY_KINDS: ReadonlySet<string> = new Set(['roof', 'carport']);
