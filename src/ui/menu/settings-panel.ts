import type { CameraMode, EngineContext, WeatherPreset, WeatherService, WeatherSettings } from '../../core/contracts';
import type { QualityPreset } from '../../core/quality';
import { el } from '../dom';
import { formatClock, formatDecimal } from '../format';
import type { UiPrefs } from '../prefs';
import { motionEffects, setMotionEffects, type MotionEffects } from '../../core/speed-feel';
import { loadMomentPrefs, saveMomentPrefs, type MomentPrefs } from '../../moments/prefs';
import { loadAdaptiveMusic, loadMusicVolume } from '../../audio/music/settings';
import type { MomentCategory } from '../../moments/types';
import { interactive, prompt, segmented, setRowsEnabled, settingDisclosure, settingRow, settingSection, slider, toggle, type Control } from '../components';

type SettingsPage = 'display' | 'world' | 'controls' | 'sound' | 'game';

const PAGES: ReadonlyArray<{ id: SettingsPage; label: string }> = [
  { id: 'display', label: 'Görüntü' },
  { id: 'world', label: 'Hava ve zaman' },
  { id: 'controls', label: 'Kontrol' },
  { id: 'sound', label: 'Ses' },
  { id: 'game', label: 'Oyun' },
];

/** Tooltip on the moment category rows while the Anlar master switch is off. */
const MOMENTS_OFF = 'Önce Anlar’ı aç';

const MOMENT_ROWS: ReadonlyArray<{ category: MomentCategory; title: string; desc: string }> = [
  { category: 'legend', title: 'Efsaneler', desc: 'Hezarfen, Lagari, Kız Kulesi gibi şehir efsaneleri' },
  { category: 'city-life', title: 'Şehir hayatı', desc: 'Martılar, vapurlar, oltacılar, leylek göçü' },
  { category: 'poem', title: 'Şiir altyazıları', desc: 'Kıyıda alçaktan süzülürken şiir dizeleri' },
];

const percentFormat = new Intl.NumberFormat('tr-TR', { style: 'percent', maximumFractionDigits: 0 });

export interface SettingsPanelOptions {
  ctx: EngineContext;
  prefs: UiPrefs;
  savePrefs(): void;
  onResetDiscoveries(): void;
  /** Opens the key bindings (the pause menu's Kontroller tab). */
  onShowControls?(): void;
  /** Oyun → İpuçları: the contextual move hints (src/ui/tutorial). */
  tutorial?: { enabled(): boolean; setEnabled(on: boolean): void; reset(): void };
}

/**
 * Ayarlar, split into pages (Görüntü · Hava ve zaman · Kontrol · Ses · Oyun) listed on the left so each page stays
 * short; the last page is remembered. Advanced weather sliders sit under a disclosure.
 */
export class SettingsPanel {
  readonly root: HTMLElement;
  private readonly pane: HTMLElement;
  private readonly quality: Control<QualityPreset>;
  private readonly sensitivity: Control<number>;
  private readonly invertMouse: Control<boolean>;
  private readonly invertPitch: Control<boolean>;
  private readonly volume: Control<number>;
  private readonly musicVolume: Control<number>;
  private readonly adaptiveMusic: Control<boolean>;
  private readonly timeOfDay: Control<number>;
  private readonly timeSpeed: Control<number>;
  private readonly camera: Control<CameraMode>;
  private readonly motion: Control<MotionEffects>;
  private readonly weatherPreset: Control<WeatherPreset | 'custom'>;
  private readonly weatherSliders: Record<keyof WeatherSettings, Control<number>>;
  private readonly momentPrefs: MomentPrefs = loadMomentPrefs();
  private readonly momentMaster: Control<boolean>;
  private readonly momentToggles: Record<MomentCategory, Control<boolean>>;
  private readonly tips: Control<boolean> | null = null;
  private readonly pages = new Map<SettingsPage, HTMLElement>();
  private readonly tabs = new Map<SettingsPage, HTMLButtonElement>();
  private page: SettingsPage = 'display';

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

    this.motion = segmented<MotionEffects>(
      'Hareket efektleri',
      [
        { value: 'full', label: 'Tam' },
        { value: 'reduced', label: 'Azaltılmış' },
        { value: 'off', label: 'Kapalı' },
      ],
      motionEffects(),
      (v) => setMotionEffects(v),
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
      value: ctx.services.tryGet('audio')?.masterVolume ?? prefs.volume ?? 1,
      format: (v) => percentFormat.format(v),
      onInput: (v) => {
        ctx.services.tryGet('audio')?.setMasterVolume(v);
        prefs.volume = v;
        save();
      },
    });

    // Music (src/audio/music): the audio service persists both.
    this.musicVolume = slider({
      label: 'Müzik',
      min: 0,
      max: 1,
      step: 0.01,
      value: ctx.services.tryGet('audio')?.musicVolume ?? loadMusicVolume(),
      format: (v) => percentFormat.format(v),
      onInput: (v) => ctx.services.tryGet('audio')?.setMusicVolume?.(v),
    });
    this.adaptiveMusic = toggle('Uyarlanabilir müzik', ctx.services.tryGet('audio')?.adaptiveMusic ?? loadAdaptiveMusic(), (v) =>
      ctx.services.tryGet('audio')?.setAdaptiveMusic?.(v),
    );

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

    const weather = (): WeatherService | undefined => ctx.services.tryGet('weather');
    this.weatherPreset = segmented<WeatherPreset | 'custom'>(
      'Hava durumu',
      [
        { value: 'clear', label: 'Açık' },
        { value: 'haze', label: 'Pus' },
        { value: 'fog', label: 'Sis' },
        { value: 'rain', label: 'Yağmur' },
        { value: 'storm', label: 'Fırtına' },
      ],
      weather()?.preset ?? 'clear',
      (preset) => {
        if (preset !== 'custom') {
          weather()?.setPreset(preset);
          this.refreshWeather();
        }
      },
    );
    const weatherSlider = (key: keyof WeatherSettings, label: string, fallback: number): Control<number> =>
      slider({
        label,
        min: 0,
        max: 1,
        step: 0.05,
        value: weather()?.settings[key] ?? fallback,
        format: (v) => (v <= 0 ? 'Kapalı' : percentFormat.format(v)),
        onInput: (v) => {
          weather()?.set({ [key]: v });
          this.weatherPreset.set(weather()?.preset ?? 'custom');
        },
      });
    this.weatherSliders = {
      fog: weatherSlider('fog', 'Sis', 0),
      rain: weatherSlider('rain', 'Yağmur', 0),
      storm: weatherSlider('storm', 'Fırtına', 0),
      farBlur: weatherSlider('farBlur', 'Uzak bulanıklık', 0.6),
    };

    // Two clicks: the first arms the reset (danger label), the second within 3.5 s clears the discoveries.
    let confirming = false;
    let confirmTimer = 0;
    const reset = prompt('Sıfırla', '', 'danger', () => {
      if (!confirming) {
        confirming = true;
        reset.root.classList.add('is-confirm');
        reset.setLabel('Emin misin? Tekrar tıkla');
        window.clearTimeout(confirmTimer);
        confirmTimer = window.setTimeout(() => {
          confirming = false;
          reset.root.classList.remove('is-confirm');
          reset.setLabel('Sıfırla');
        }, 3500);
        return;
      }
      window.clearTimeout(confirmTimer);
      confirming = false;
      reset.root.classList.remove('is-confirm');
      reset.setLabel('Sıfırlandı');
      options.onResetDiscoveries();
    });

    // Oyun → Anlar: a master switch and one switch per category (the dependent rows grey out when it is off).
    const saveMoments = (): void => saveMomentPrefs(this.momentPrefs);
    const momentSubRows: HTMLElement[] = [];
    this.momentToggles = {} as Record<MomentCategory, Control<boolean>>;
    for (const m of MOMENT_ROWS) {
      const control = toggle(m.title, this.momentPrefs.categories[m.category], (v) => {
        this.momentPrefs.categories[m.category] = v;
        saveMoments();
      });
      this.momentToggles[m.category] = control;
      momentSubRows.push(settingRow(m.title, m.desc, control.root, { sub: true }));
    }
    this.momentMaster = toggle('Anlar', this.momentPrefs.enabled, (v) => {
      this.momentPrefs.enabled = v;
      saveMoments();
      setRowsEnabled(momentSubRows, v, MOMENTS_OFF);
    });
    setRowsEnabled(momentSubRows, this.momentPrefs.enabled, MOMENTS_OFF);

    // Oyun → İpuçları: the switch and a reset that lets every move hint show again.
    const tutorial = options.tutorial;
    let tipsSection: HTMLElement[] = [];
    if (tutorial) {
      this.tips = toggle('İpuçları', tutorial.enabled(), (v) => tutorial.setEnabled(v));
      let resetTimer = 0;
      const resetTips = prompt('Sıfırla', '', 'secondary', () => {
        tutorial.reset();
        resetTips.setLabel('Sıfırlandı');
        window.clearTimeout(resetTimer);
        resetTimer = window.setTimeout(() => resetTips.setLabel('Sıfırla'), 2500);
      });
      tipsSection = [
        settingSection('İpuçları', [
          settingRow('İpuçları', 'Yeni hareketleri doğru anda, kısaca gösterir; bir hareketi temiz yapınca o ipucu bir daha çıkmaz', this.tips.root),
          settingRow('İpuçlarını sıfırla', 'Gösterilen ve öğrenilen ipuçlarını baştan alır', resetTips.root),
        ]),
      ];
    }

    const controlsLink = prompt('Kontroller', '', 'secondary', () => options.onShowControls?.());

    const pageContent: Record<SettingsPage, HTMLElement[]> = {
      display: [
        settingSection('Görüntü', [
          settingRow('Grafik kalitesi', 'Gölge, bulut, yansıma ve çizim mesafesi', this.quality.root),
          settingRow('Kamera', undefined, this.camera.root, { keys: 'C' }),
          settingRow('Hareket efektleri', 'Hızda görüş açısı, sarsıntı ve rüzgâr çizgileri; hareket hassasiyetinde azalt', this.motion.root),
          settingRow('Uzak bulanıklık', 'Uzaktaki şehri havanın yaptığı gibi yumuşatır', this.weatherSliders.farBlur.root),
        ]),
      ],
      world: [
        settingSection('Hava', [
          settingRow('Hava durumu', undefined, this.weatherPreset.root, { keys: 'N' }),
          settingDisclosure('Ayrıntılı ayarla', [
            settingRow('Sis', 'Yerde sis bankları, kalın pus', this.weatherSliders.fog.root, { sub: true }),
            settingRow('Yağmur', 'Yağmur, kapalı gökyüzü, yağmur sesi', this.weatherSliders.rain.root, { sub: true }),
            settingRow('Fırtına', 'Şimşek ve gök gürültüsü', this.weatherSliders.storm.root, { sub: true }),
          ]),
        ]),
        settingSection('Zaman', [
          settingRow('Günün saati', 'Yarım saat ileri, geri', this.timeOfDay.root, { keys: '[ / ]' }),
          settingRow('Zaman akışı', 'Gerçek saniye başına oyun dakikası', this.timeSpeed.root),
        ]),
      ],
      controls: [
        settingSection('Fare', [
          settingRow('Fare hassasiyeti', undefined, this.sensitivity.root),
          settingRow('Fare Y eksenini ters çevir', 'Bakış yönünde yukarı, aşağı', this.invertMouse.root),
        ]),
        settingSection('Klavye', [
          settingRow('W/S eksenini ters çevir', 'Açıkken W burnu yukarı kaldırır', this.invertPitch.root),
          settingRow('Tüm tuşlar', 'Uçuş, kamera ve arayüz kısayolları', controlsLink.root),
        ]),
      ],
      sound: [
        settingSection('Ses', [
          settingRow('Ana ses', undefined, this.volume.root),
          settingRow('Müzik', undefined, this.musicVolume.root),
          settingRow('Uyarlanabilir müzik', 'Müzik uçuşuna göre katman katman değişir; kapalıyken parçalar tam haliyle çalar', this.adaptiveMusic.root),
        ]),
      ],
      game: [
        settingSection(
          'Anlar',
          [settingRow('Anlar', 'Haritaya serpiştirilmiş küçük sürprizler', this.momentMaster.root), ...momentSubRows],
          'Uçarken karşına çıkan kısa sahneler ve altyazılar. İstemediklerini kapatabilirsin.',
        ),
        ...tipsSection,
        settingSection('İlerleme', [settingRow('Keşifleri sıfırla', 'Keşfedilen simge yapılar listesini temizler', reset.root)]),
      ],
    };

    const nav = el(
      'nav',
      'menu-cats',
      PAGES.map((p) => {
        const button = interactive(el('button', 'menu-cat', p.label, { type: 'button', role: 'tab', 'aria-selected': 'false' }), 'surface');
        button.addEventListener('click', () => this.showPage(p.id, true));
        this.tabs.set(p.id, button);
        return button;
      }),
      { role: 'tablist', 'aria-orientation': 'vertical', 'aria-label': 'Ayar bölümleri' },
    );
    nav.addEventListener('keydown', (e) => {
      if (e.code !== 'ArrowUp' && e.code !== 'ArrowDown') {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const i = PAGES.findIndex((p) => p.id === this.page);
      const next = PAGES[(i + (e.code === 'ArrowDown' ? 1 : PAGES.length - 1)) % PAGES.length].id;
      this.showPage(next, true);
      this.tabs.get(next)?.focus();
    });
    const pageNodes = PAGES.map((p) => {
      const node = el('div', 'set-page', pageContent[p.id], { role: 'tabpanel' });
      this.pages.set(p.id, node);
      return node;
    });

    this.pane = el('div', 'menu-pane set-pane', pageNodes);
    this.root = el('div', 'menu-split menu-settings', [nav, this.pane]);
    const saved = prefs.settingsPage as SettingsPage | undefined;
    this.showPage(saved && this.pages.has(saved) ? saved : 'display', false);
  }

  private showPage(page: SettingsPage, remember: boolean): void {
    this.page = page;
    for (const [id, node] of this.pages) {
      node.hidden = id !== page;
    }
    for (const [id, tab] of this.tabs) {
      const on = id === page;
      tab.classList.toggle('is-on', on);
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
    }
    this.pane?.scrollTo({ top: 0 });
    if (remember) {
      this.options.prefs.settingsPage = page;
      this.options.savePrefs();
    }
  }

  /** Re-read live values (time of day moves, camera may have been switched with C...). */
  refresh(): void {
    const { ctx } = this.options;
    this.quality.set(ctx.quality.settings.preset);
    this.motion.set(motionEffects());
    this.sensitivity.set(ctx.input.settings.mouseSensitivity);
    this.invertMouse.set(ctx.input.settings.invertMouseY);
    this.invertPitch.set(ctx.input.settings.invertPitch);
    this.volume.set(ctx.services.tryGet('audio')?.masterVolume ?? this.options.prefs.volume ?? 1);
    this.musicVolume.set(ctx.services.tryGet('audio')?.musicVolume ?? loadMusicVolume());
    this.adaptiveMusic.set(ctx.services.tryGet('audio')?.adaptiveMusic ?? loadAdaptiveMusic());
    this.timeOfDay.set(Math.round(ctx.time.timeOfDay * 4) / 4);
    this.timeSpeed.set(ctx.time.dayTimeScale);
    const mode = ctx.services.tryGet('cameraRig')?.mode;
    this.camera.set(mode === 'free' || !mode ? 'third' : mode);
    this.refreshWeather();
    this.momentMaster.set(this.momentPrefs.enabled);
    if (this.tips && this.options.tutorial) {
      this.tips.set(this.options.tutorial.enabled());
    }
    for (const m of MOMENT_ROWS) {
      this.momentToggles[m.category].set(this.momentPrefs.categories[m.category]);
    }
  }

  /** Weather changes from the N key or a preset: re-read every weather control. */
  private refreshWeather(): void {
    const weather = this.options.ctx.services.tryGet('weather');
    if (!weather) {
      return;
    }
    this.weatherPreset.set(weather.preset);
    for (const key of Object.keys(this.weatherSliders) as (keyof WeatherSettings)[]) {
      this.weatherSliders[key].set(weather.settings[key]);
    }
  }
}
