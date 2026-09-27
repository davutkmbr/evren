import type { EngineContext } from '../../core/contracts';
import { el } from '../dom';
import { formatDecimal } from '../format';
import { segmented, settingRow, settingSection, slider, toggle } from '../components';
import { HAIR_COLORS, PALETTES, saveRiderLook, type FaceArchetype, type HairStyle, type Headwear, type RiderLook, loadRiderLook } from '../../dragon/model/rider/look';

interface LookTarget {
  setRiderLook?(look: RiderLook): void;
}

/**
 * Binici: the rider's look. Origin (the dress's colours), headwear, hair, face, skin, armour; every change applies to
 * the rider at once and is remembered.
 */
export class RiderPanel {
  readonly root: HTMLElement;
  private look: RiderLook = loadRiderLook();

  constructor(private readonly ctx: EngineContext) {
    const apply = (): void => {
      saveRiderLook(this.look);
      (ctx.services.tryGet('rig') as LookTarget | undefined)?.setRiderLook?.(this.look);
    };
    const paletteKey = Object.keys(PALETTES).find((k) => PALETTES[k].primary === this.look.palette.primary) ?? 'akinci';
    const origin = segmented(
      'Köken',
      [
        { value: 'akinci', label: 'Akıncı' },
        { value: 'sipahi', label: 'Sipahi' },
        { value: 'deli', label: 'Deli' },
        { value: 'yeniceri', label: 'Yeniçeri' },
      ],
      paletteKey,
      (v) => {
        this.look.palette = PALETTES[v];
        apply();
      },
    );
    const headwear = segmented<Headwear>(
      'Başlık',
      [
        { value: 'cicak', label: 'Çiçak' },
        { value: 'none', label: 'Başı açık' },
      ],
      this.look.headwear,
      (v) => {
        this.look.headwear = v;
        apply();
      },
    );
    const hair = segmented<HairStyle>(
      'Saç',
      [
        { value: 'braid01', label: 'Örgü' },
        { value: 'short02', label: 'Kısa' },
        { value: 'ponytail01', label: 'Tepede topuz' },
      ],
      this.look.hair,
      (v) => {
        this.look.hair = v;
        apply();
      },
    );
    const hairColor = segmented<string>(
      'Saç rengi',
      [
        { value: HAIR_COLORS[0], label: 'Siyah' },
        { value: HAIR_COLORS[1], label: 'Koyu kahve' },
        { value: HAIR_COLORS[2], label: 'Kahve' },
        { value: HAIR_COLORS[3], label: 'Kumral' },
        { value: HAIR_COLORS[4], label: 'Kır' },
      ],
      this.look.hairColor,
      (v) => {
        this.look.hairColor = v;
        apply();
      },
    );
    const face = segmented<FaceArchetype>(
      'Yüz',
      [
        { value: 'noble', label: 'Asil' },
        { value: 'sharp', label: 'Keskin' },
        { value: 'broad', label: 'Geniş' },
        { value: 'weathered', label: 'Yıpranmış' },
        { value: 'young', label: 'Genç' },
      ],
      this.look.face,
      (v) => {
        this.look.face = v;
        apply();
      },
    );
    const skin = slider({
      label: 'Ten',
      min: -1,
      max: 1,
      step: 0.05,
      value: this.look.skin,
      format: (v) => (Math.abs(v) < 0.03 ? 'Doğal' : v < 0 ? `Açık ${formatDecimal(-v, 1)}` : `Koyu ${formatDecimal(v, 1)}`),
      onInput: (v) => {
        this.look.skin = v;
        apply();
      },
    });
    const armour = toggle('Zırh', this.look.armour, (v) => {
      this.look.armour = v;
      apply();
    });
    this.root = el('div', 'menu-panel rider-panel', [
      settingSection(
        'Binici',
        [
          settingRow('Köken', 'Kıyafetin renkleri: akıncı kırmızısı, sipahi mavisi, deli toprağı, yeniçeri beyazı', origin.root),
          settingRow('Başlık', 'Çiçak miğferi ya da başı açık', headwear.root),
          settingRow('Saç', 'Başı açıkken görünür', hair.root),
          settingRow('Saç rengi', undefined, hairColor.root),
          settingRow('Yüz', undefined, face.root),
          settingRow('Ten', undefined, skin.root),
          settingRow('Zırh', 'Zincir yelek ve göğüs aynası', armour.root),
        ],
        'Binicinin görünüşü. Değişiklikler hemen uygulanır ve hatırlanır.',
      ),
    ]);
    // The saved look reaches the rider at start (the rig may come later).
    void ctx.services.when('rig').then((r) => (r as LookTarget).setRiderLook?.(this.look));
  }

  opened(): void {
    // Nothing to refresh: the controls hold the live look.
  }
}
