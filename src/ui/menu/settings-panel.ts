import type { CameraMode, EngineContext } from '../../core/contracts';
import type { QualityPreset } from '../../core/quality';
import { el } from '../dom';
import { formatClock, formatDecimal } from '../format';
import type { UiPrefs } from '../prefs';
import { segmented, settingRow, settingSection, slider, toggle, type Control } from './controls';

const percentFormat = new Intl.NumberFormat('tr-TR', { style: 'percent', maximumFractionDigits: 0 });

export interface SettingsPanelOptions {
  ctx: EngineContext;
  prefs: UiPrefs;
  savePrefs(): void;
  onResetDiscoveries(): void;
}

/** Ayarlar: quality preset, controls, volume, time of day / speed, camera mode. */
export class SettingsPanel {
  readonly root: HTMLElement;
  private readonly quality: Control<QualityPreset>;
  private readonly sensitivity: Control<number>;
  private readonly invertMouse: Control<boolean>;
  private readonly invertPitch: Control<boolean>;
  private readonly volume: Control<number>;
  private readonly timeOfDay: Control<number>;
  private readonly timeSpeed: Control<number>;
  private readonly camera: Control<CameraMode>;

  constructor(private readonly options: SettingsPanelOptions) {
    const { ctx, prefs } = options;
    const save = (): void => options.savePrefs();

    this.quality = segmented<QualityPreset>(
      'Grafik kalitesi',
      [
        { value: 'low', label: 'Düşük' },
        { value: 'medium', label: 'Orta' },
        { value: 'high', label: 'Yüksek' },
        { value: 'ultra', label: 'Ultra' },
      ],
      ctx.quality.settings.preset,
      (preset) => {
        ctx.quality.setPreset(preset);
        ctx.events.emit('quality-changed', { preset });
        prefs.quality = preset;
        save();
      },
    );

    this.camera = segmented<CameraMode>(
      'Kamera',
      [
        { value: 'third', label: '3. şahıs' },
        { value: 'pov', label: 'Binici' },
        { value: 'cinematic', label: 'Sinematik' },
      ],
      'third',
      (mode) => ctx.services.tryGet('cameraRig')?.setMode(mode),
    );

    this.sensitivity = slider({
      label: 'Fare hassasiyeti',
      min: 0.25,
      max: 3,
      step: 0.05,
      value: ctx.input.settings.mouseSensitivity,
      format: (v) => `${formatDecimal(v, 2)}×`,
      onInput: (v) => {
        ctx.input.settings.mouseSensitivity = v;
        prefs.mouseSensitivity = v;
        save();
      },
    });
    this.invertMouse = toggle('Fare Y eksenini ters çevir', ctx.input.settings.invertMouseY, (v) => {
      ctx.input.settings.invertMouseY = v;
      prefs.invertMouseY = v;
      save();
    });
    this.invertPitch = toggle('W/S eksenini ters çevir', ctx.input.settings.invertPitch, (v) => {
      ctx.input.settings.invertPitch = v;
      prefs.invertPitch = v;
      save();
    });

    this.volume = slider({
      label: 'Ana ses',
      min: 0,
      max: 1,
      step: 0.01,
      value: prefs.volume ?? 1,
      format: (v) => percentFormat.format(v),
      onInput: (v) => {
        ctx.services.tryGet('audio')?.setMasterVolume(v);
        prefs.volume = v;
        save();
      },
    });

    this.timeOfDay = slider({
      label: 'Günün saati',
      min: 0,
      max: 23.75,
      step: 0.25,
      value: ctx.time.timeOfDay,
      format: (v) => formatClock(v),
      onInput: (v) => ctx.services.tryGet('env')?.setTimeOfDay(v),
    });
    this.timeSpeed = segmented<number>(
      'Zaman akışı',
      [
        { value: 0, label: 'Sabit' },
        { value: 1, label: '1 dk/sn' },
        { value: 5, label: '5 dk/sn' },
        { value: 30, label: '30 dk/sn' },
      ],
      ctx.time.dayTimeScale,
      (v) => {
        ctx.time.dayTimeScale = v;
      },
    );

    const resetButton = el('button', 'btn-quiet', 'Sıfırla', { type: 'button' });
    let confirmTimer = 0;
    resetButton.addEventListener('click', () => {
      if (!resetButton.classList.contains('is-confirm')) {
        resetButton.classList.add('is-confirm');
        resetButton.textContent = 'Emin misin? Tekrar tıkla';
        window.clearTimeout(confirmTimer);
        confirmTimer = window.setTimeout(() => {
          resetButton.classList.remove('is-confirm');
          resetButton.textContent = 'Sıfırla';
        }, 3500);
        return;
      }
      window.clearTimeout(confirmTimer);
      resetButton.classList.remove('is-confirm');
      resetButton.textContent = 'Sıfırlandı';
      options.onResetDiscoveries();
    });

    this.root = el('div', 'menu-settings', [
      settingSection('Görüntü', [
        settingRow('Grafik kalitesi', 'Gölge, bulut, yansıma ve çizim mesafesi', this.quality.root),
        settingRow('Kamera', 'C tuşuyla da değiştirilebilir', this.camera.root),
      ]),
      settingSection('Zaman', [
        settingRow('Günün saati', '[ ve ] tuşlarıyla yarım saat ileri, geri', this.timeOfDay.root),
        settingRow('Zaman akışı', 'Gerçek saniye başına oyun dakikası', this.timeSpeed.root),
      ]),
      settingSection('Kontrol', [
        settingRow('Fare hassasiyeti', undefined, this.sensitivity.root),
        settingRow('Fare Y eksenini ters çevir', 'Bakış yönünde yukarı, aşağı', this.invertMouse.root),
        settingRow('W/S eksenini ters çevir', 'Açıkken W burnu yukarı kaldırır', this.invertPitch.root),
      ]),
      settingSection('Ses', [settingRow('Ana ses', undefined, this.volume.root)]),
      settingSection('İlerleme', [settingRow('Keşifleri sıfırla', 'Keşfedilen simge yapılar listesini temizler', resetButton)]),
    ]);
  }

  /** Re-read live values (time of day moves, camera may have been switched with C...). */
  refresh(): void {
    const { ctx } = this.options;
    this.quality.set(ctx.quality.settings.preset);
    this.sensitivity.set(ctx.input.settings.mouseSensitivity);
    this.invertMouse.set(ctx.input.settings.invertMouseY);
    this.invertPitch.set(ctx.input.settings.invertPitch);
    this.volume.set(this.options.prefs.volume ?? 1);
    this.timeOfDay.set(Math.round(ctx.time.timeOfDay * 4) / 4);
    this.timeSpeed.set(ctx.time.dayTimeScale);
    const mode = ctx.services.tryGet('cameraRig')?.mode;
    this.camera.set(mode === 'free' || !mode ? 'third' : mode);
  }
}
