/**
 * Shared UI components (the design language's building blocks). Every screen builds its keys, actions, options,
 * values and medal targets from these, so they look and behave the same everywhere. Styles: styles/components.css.
 */
import '../styles/components.css';

export { keyCap, keyCombo, type KeyCapTone } from './keycap';
export { prompt, type Prompt, type PromptVariant } from './prompt';
export { interactive, bindKeyPress, flashPressed, keyToken, type InteractionFamily } from './interaction';
export { optionSwitch, type OptionSwitch } from './switch';
export { stat, type Stat } from './stat';
export { medalLadder, type Medal, type MedalLadder } from './medal-ladder';

/* Map and canvas view pieces: layer rows, hover card, zoom buttons, scale bar, pointer hint line. */
export { layerToggle, layerGroup, type LayerToggle, type LayerToggleOptions, type LayerMark } from './layer-toggle';
export { hoverCard, type HoverCard } from './hover-card';
export { zoomCluster, type ZoomCluster, type ZoomClusterOptions } from './zoom-cluster';
export { scaleBar, type ScaleBar } from './scale-bar';
export { hintLine } from './hint-line';
export { keyHint, type KeyHint } from './key-hint';
export { medalDot, medalDisc, type MedalMark } from './medal';
export { pill, type Pill, type PillTone } from './pill';
export { legend, type LegendItem, type LegendSwatch } from './legend';
export { listRow, type ListRow, type ListRowContent, type ListRowOptions } from './list-row';
export { textField, type TextField, type TextFieldOptions } from './text-field';
export { routeMap, frameRoute, type RouteMap, type RouteMapData, type RouteMapOptions, type RoutePoint, type RouteFrame, type WaterSampler } from './route-map';
export { divergingBars, divergingBar, divergingExtent, divergingRowHeight, type DivergingBars, type DivergingBarsOptions, type DivergingRow } from './diverging-bars';

/* Key cap sizes and states, key caps inside sentences. */
export { setKeyCapState, type KeyCapSize, type KeyCapState, type KeyCapOptions } from './keycap';
export { keyText } from './key-text';

/* Settings controls: segmented control, slider with readout, on/off switch, setting rows and sections. */
export { segmented, type Control } from './segmented';
export { slider, type SliderOptions } from './slider';
export { toggle } from './toggle';
export { settingRow, settingSection, settingDisclosure, setRowsEnabled, type SettingRowOptions } from './setting-row';
