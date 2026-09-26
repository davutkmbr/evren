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
