/**
 * Shared UI components (the design language's building blocks). Every screen builds its keys, actions, options,
 * values and medal targets from these, so they look and behave the same everywhere. Styles: styles/components.css.
 */
import '../styles/components.css';

export { keyCap, keyCombo, type KeyCapTone } from './keycap';
export { prompt, type Prompt, type PromptVariant } from './prompt';
export { optionSwitch, type OptionSwitch } from './switch';
export { stat, type Stat } from './stat';
export { medalLadder, type Medal, type MedalLadder } from './medal-ladder';

/* Map and canvas view pieces: layer rows, hover card, zoom buttons, scale bar, pointer hint line. */
export { layerToggle, layerGroup, type LayerToggle, type LayerToggleOptions, type LayerMark } from './layer-toggle';
export { hoverCard, type HoverCard } from './hover-card';
export { zoomCluster, type ZoomCluster, type ZoomClusterOptions } from './zoom-cluster';
export { scaleBar, type ScaleBar } from './scale-bar';
export { hintLine } from './hint-line';
