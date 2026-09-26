import type { EngineContext, HotbarService } from '../../core/contracts';

/** Mirrors the flight model's roar gate (src/dragon/flight: 2.6 s cooldown, not while breathing fire). */
const ROAR_COOLDOWN_S = 2.6;

/**
 * The dragon's two built-in abilities on the hotbar (slot 1 fire, slot 2 roar), registered from the UI side.
 * Fire and roar are driven by their own keys (F / R) inside flight; this only mirrors their state onto the slots:
 * fire is active while DragonState.firing, roar shows the cooldown after an accepted R press. Pressing the slot's
 * number key explains the real key for now (flight has no hook yet to trigger them from outside).
 */
export class DragonAbilities {
  private roarCooldown = 0;

  constructor(
    private readonly hotbar: HotbarService,
    private readonly hint: (text: string) => void,
  ) {
    hotbar.set(0, {
      id: 'fire',
      kind: 'ability',
      label: 'Ateş püskür',
      icon: 'fire',
      hotkey: 'F',
      activate: () => this.hint('Ateş püskürmek için F tuşunu (ya da sol tıkı) basılı tut'),
    });
    hotbar.set(1, {
      id: 'roar',
      kind: 'ability',
      label: 'Kükre',
      icon: 'roar',
      hotkey: 'R',
      activate: () => this.hint('Kükremek için R tuşuna bas'),
    });
  }

  /** Every frame (simulation dt: the flight cooldown only runs while unpaused). */
  update(dt: number, ctx: EngineContext): void {
    const dragon = ctx.services.tryGet('dragon');
    const firing = !!dragon?.firing;
    this.roarCooldown = Math.max(0, this.roarCooldown - dt);
    if (dragon && dt > 0 && ctx.input.enabled && this.roarCooldown <= 0 && !firing && ctx.input.wasPressed('roar')) {
      this.roarCooldown = ROAR_COOLDOWN_S;
    }
    this.hotbar.update('fire', { active: firing, enabled: !!dragon });
    this.hotbar.update('roar', { cooldown: Math.ceil((this.roarCooldown / ROAR_COOLDOWN_S) * 100) / 100, enabled: !!dragon });
  }
}
