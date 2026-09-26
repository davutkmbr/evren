import type { DragonState, HotbarService } from '../../core/contracts';

/** Seconds of fire one press of the hotbar slot breathes (the F key keeps working as a hold). */
const FIRE_BURST_S = 1.2;

/**
 * The dragon's two built-in abilities on the hotbar (slot 1 fire, slot 2 roar), registered from the UI side.
 * Pressing the slot's number key calls flight through DragonState (fireBurst, requestRoar); the slots mirror flight's
 * state: fire is active while DragonState.firing, roar shows DragonState.roarCooldown.
 */
export class DragonAbilities {
  constructor(
    private readonly hotbar: HotbarService,
    private readonly dragon: () => DragonState | undefined,
  ) {
    hotbar.set(0, {
      id: 'fire',
      kind: 'ability',
      label: 'Ateş püskür',
      icon: 'fire',
      hotkey: 'F',
      activate: () => this.dragon()?.fireBurst?.(FIRE_BURST_S),
    });
    hotbar.set(1, {
      id: 'roar',
      kind: 'ability',
      label: 'Kükre',
      icon: 'roar',
      hotkey: 'R',
      activate: () => void this.dragon()?.requestRoar?.(),
    });
  }

  /** Every frame. */
  update(): void {
    const dragon = this.dragon();
    this.hotbar.update('fire', { active: !!dragon?.firing, enabled: !!dragon });
    this.hotbar.update('roar', { cooldown: Math.ceil((dragon?.roarCooldown ?? 0) * 100) / 100, enabled: !!dragon && !dragon.firing });
  }
}
