import * as THREE from 'three';
import type { CameraMode, EngineContext, System } from '../core/contracts';
import { UpdateOrder } from '../core/contracts';
import type { QualityPreset } from '../core/quality';
import { QUALITY_PRESETS } from '../core/quality';
import { DiscoveryTracker } from './discovery/discovery-tracker';
import { el } from './dom';
import { Hud } from './hud/hud';
import { LoadingScreen } from './loading/loading-screen';
import { FullMap, type TeleportTarget } from './map/full-map';
import { MapRaster } from './map/map-raster';
import { Minimap } from './map/minimap';
import { buildControlsList } from './menu/controls-panel';
import { PauseMenu, type MenuTab } from './menu/pause-menu';
import { SettingsPanel } from './menu/settings-panel';
import { TeleportPanel } from './menu/teleport-panel';
import { FlightHints, HoverHints, PhotoHint, ShotCaption } from './overlays/hints';
import { HelpOverlay } from './overlays/help-overlay';
import { StatsOverlay } from './overlays/stats-overlay';
import { Toasts } from './overlays/toasts';
import { loadPrefs, savePrefs, type UiPrefs } from './prefs';
import { createSnapshot } from './types';
import './styles/base.css';
import './styles/loading.css';
import './styles/hud.css';
import './styles/map.css';
import './styles/menu.css';
import './styles/overlays.css';

type Modal = 'none' | 'pause' | 'map';
export type UiDebugTarget = MenuTab | 'pause' | 'map' | 'help' | 'photo';

const MAP_RASTER_SIZE = 3072;
const HINTS_MS = 14000;
const RAD = 180 / Math.PI;

/** Turkish UI: loading/start screens, HUD, discovery, minimap + full map, pause/settings, help, toasts, photo mode. */
export class UiSystem implements System {
  readonly name = 'ui';
  readonly order = UpdateOrder.UI;

  private ctx!: EngineContext;
  private root!: HTMLElement;
  private readonly prefs: UiPrefs = loadPrefs();
  private readonly snapshot = createSnapshot();
  private readonly raster = new MapRaster();
  private readonly toasts = new Toasts();
  private readonly hints = new FlightHints();
  private readonly hoverHints = new HoverHints();
  private readonly shotCaption = new ShotCaption();
  /** Flight mode seen last frame (null without a dragon): entering a hover shows its controls. */
  private lastFlightMode: string | null = null;
  private readonly photoHint = new PhotoHint();
  private readonly viewDir = new THREE.Vector3();
  private loading: LoadingScreen | null = null;
  private tracker!: DiscoveryTracker;
  private hud!: Hud;
  private fullMap!: FullMap;
  private pauseMenu!: PauseMenu;
  private settings!: SettingsPanel;
  private help!: HelpOverlay;
  private stats: StatsOverlay | null = null;
  private autoStart = false;
  private started = false;
  private modal: Modal = 'none';
  private photo = false;
  private hudOff = false;
  private hudShown = false;
  private pausedBeforeStart = false;
  private pausedBeforeModal = false;
  private pausedBeforePhoto = false;
  private cameraBeforePhoto: CameraMode = 'third';
  private reenableInputFrame = -1;
  private readonly disposers: Array<() => void> = [];

  init(ctx: EngineContext): void {
    this.ctx = ctx;
    const params = ctx.debug.params;
    this.autoStart = ctx.debug.freeze || ctx.debug.nohud || params.get('autostart') === '1';
    this.applyPrefs();

    this.root = el('div', 'ejd is-prestart', undefined, { lang: 'tr' });
    if (ctx.debug.nohud) {
      this.root.classList.add('is-nohud');
    }
    ctx.uiRoot.append(this.root);

    this.loading = new LoadingScreen(this.root, { autoStart: this.autoStart, onStart: () => this.onStart() });

    this.tracker = new DiscoveryTracker(ctx);
    this.hud = new Hud(new Minimap(this.raster), this.tracker.card, this.hints, this.hoverHints, this.shotCaption);
    this.fullMap = new FullMap(this.raster, {
      onTeleport: (target) => this.teleport(target),
      onClose: () => this.closeModal(),
    });
    this.settings = new SettingsPanel({
      ctx,
      prefs: this.prefs,
      savePrefs: () => savePrefs(this.prefs),
      onResetDiscoveries: () => {
        this.tracker.reset();
        this.toasts.push('Keşif ilerlemesi sıfırlandı');
      },
      onShowControls: () => this.pauseMenu.show('controls'),
    });
    const teleportPanel = new TeleportPanel((_name, preset) => {
      if (preset.time !== undefined) {
        ctx.services.tryGet('env')?.setTimeOfDay(preset.time);
      }
      this.teleport({ x: preset.x, y: preset.y, z: preset.z, headingDeg: preset.headingDeg, pitchDeg: preset.pitchDeg, label: preset.label });
    }, () => this.openModal('map'));
    this.pauseMenu = new PauseMenu({
      panels: { settings: this.settings.root, teleport: teleportPanel.root, controls: el('div', 'menu-controls', [el('p', 'menu-lede', 'Oyun sırasında H tuşuyla da bu listeyi açabilirsin.'), buildControlsList()]) },
      onResume: () => this.closeModal(),
      onTabOpen: (tab) => {
        if (tab === 'settings') {
          this.settings.refresh();
        } else if (tab === 'teleport') {
          teleportPanel.setPerches(ctx.services.tryGet('perches')?.points);
          teleportPanel.reset();
        }
      },
      onClick: () => this.click(),
    });
    this.help = new HelpOverlay(() => this.help.setOpen(false));

    this.root.append(this.hud.root, this.toasts.root, this.photoHint.root, this.help.root, this.fullMap.root, this.pauseMenu.root);
    if (ctx.debug.stats) {
      this.stats = new StatsOverlay();
      this.root.append(this.stats.root);
    }
    this.hud.root.hidden = true;

    this.tracker.onChange((isNew) => {
      this.hud.counter.set(this.tracker.count, this.tracker.total, isNew);
      this.pauseMenu.setProgress(this.tracker.count, this.tracker.total);
    });

    const { events, services } = ctx;
    this.disposers.push(
      events.on('loading-progress', ({ label, progress }) => this.loading?.setProgress(label, progress)),
      events.on('loading-done', () => this.onLoadingDone()),
      events.on('toast', ({ text, kind }) => this.toasts.push(text, kind)),
      events.on('camera-mode', ({ mode }) => this.hud.instruments.setCameraMode(mode)),
      this.hud.maneuver.connect(events),
    );

    void services.when('geo').then((geo) => {
      this.raster.build(geo, MAP_RASTER_SIZE);
      this.tracker.setGeo(geo);
      this.hud.compass.setLandmarks(geo.landmarks, this.tracker.discovered);
      this.hud.minimap.setGeo(geo, this.tracker.discovered);
      this.fullMap.setGeo(geo, this.tracker.discovered);
    });
    void services.when('cameraRig').then((rig) => this.hud.instruments.setCameraMode(rig.mode));
    void services.when('audio').then((audio) => {
      // Older audio services do not keep the volume themselves: restore the UI's saved value into them.
      if (audio.masterVolume === undefined && this.prefs.volume !== undefined) {
        audio.setMasterVolume(this.prefs.volume);
      }
    });

    const onPointerLockChange = (): void => this.onPointerLockChange();
    // The UI is the single pointer-lock owner (start screen, canvas clicks, closing a menu); cameras only read it.
    const onCanvasClick = (): void => {
      if (this.started && this.modal === 'none' && !this.ctx.input.pointerLocked) {
        this.ctx.input.requestPointerLock();
      }
    };
    const onKeyDown = (e: KeyboardEvent): void => this.onKeyDown(e);
    document.addEventListener('pointerlockchange', onPointerLockChange);
    ctx.canvas.addEventListener('click', onCanvasClick);
    window.addEventListener('keydown', onKeyDown);
    this.disposers.push(
      () => document.removeEventListener('pointerlockchange', onPointerLockChange),
      () => ctx.canvas.removeEventListener('click', onCanvasClick),
      () => window.removeEventListener('keydown', onKeyDown),
    );

    if (import.meta.env.DEV || ctx.sandbox) {
      this.installDebugHook();
    }
  }

  update(_dt: number, ctx: EngineContext): void {
    const realDt = ctx.time.realDt;
    if (this.reenableInputFrame >= 0 && ctx.time.frame >= this.reenableInputFrame) {
      this.reenableInputFrame = -1;
      ctx.input.enabled = true;
    }
    this.stats?.update(realDt);
    if (!this.started) {
      return;
    }
    this.fillSnapshot(ctx);
    this.handleInput(ctx);
    this.updateContextHints(ctx);

    const hudVisible = !ctx.debug.nohud && !this.hudOff && !this.photo && this.modal === 'none';
    if (hudVisible !== this.hudShown) {
      this.hudShown = hudVisible;
      this.hud.root.hidden = !hudVisible;
      if (hudVisible) {
        this.hud.measure();
      }
    }
    if (hudVisible && this.snapshot.valid) {
      const env = ctx.services.tryGet('env');
      const sunElevation = env ? Math.asin(Math.max(-1, Math.min(1, env.sunDirection.y))) * RAD : 30;
      this.hud.update(this.snapshot, realDt, ctx.time.timeOfDay, sunElevation);
    }
    this.tracker.update(this.snapshot, realDt, hudVisible);
  }

  pending(): number {
    return this.raster.pending ? 1 : 0;
  }

  onResize(): void {
    if (this.hudShown) {
      this.hud.measure();
    }
    this.fullMap?.resize();
  }

  dispose(): void {
    for (const fn of this.disposers.splice(0)) {
      fn();
    }
    this.loading?.dispose();
    this.tracker?.dispose();
    this.fullMap?.dispose();
    this.raster.dispose();
    this.root?.remove();
  }

  /* ---------------- lifecycle ---------------- */

  private applyPrefs(): void {
    const { input, quality, debug } = this.ctx;
    const p = this.prefs;
    if (typeof p.mouseSensitivity === 'number' && Number.isFinite(p.mouseSensitivity)) {
      input.settings.mouseSensitivity = Math.min(3, Math.max(0.25, p.mouseSensitivity));
    }
    if (typeof p.invertMouseY === 'boolean') {
      input.settings.invertMouseY = p.invertMouseY;
    }
    if (typeof p.invertPitch === 'boolean') {
      input.settings.invertPitch = p.invertPitch;
    }
    const preset = p.quality as QualityPreset | undefined;
    if (preset && preset in QUALITY_PRESETS && !debug.quality && !this.autoStart && preset !== quality.settings.preset) {
      quality.setPreset(preset);
    }
  }

  private onLoadingDone(): void {
    if (!this.autoStart) {
      this.pausedBeforeStart = this.ctx.time.paused;
      this.ctx.events.emit('pause', { paused: true });
    }
    this.loading?.finish();
  }

  private onStart(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.root.classList.remove('is-prestart');
    if (!this.autoStart) {
      // The start click/key is the user gesture: unlock audio and take the pointer (the UI owns pointer lock).
      this.ctx.services.tryGet('audio')?.unlock?.();
      this.ctx.events.emit('pause', { paused: this.pausedBeforeStart });
      this.ctx.input.requestPointerLock();
      this.hints.show(HINTS_MS);
    }
    this.loading = null;
  }

  /* ---------------- per-frame ---------------- */

  private fillSnapshot(ctx: EngineContext): void {
    const s = this.snapshot;
    const dragon = ctx.services.tryGet('dragon');
    const camera = ctx.camera;
    camera.getWorldDirection(this.viewDir);
    const horizontal = Math.hypot(this.viewDir.x, this.viewDir.z);
    if (dragon) {
      s.valid = true;
      s.x = dragon.position.x;
      s.y = dragon.position.y;
      s.z = dragon.position.z;
      s.headingDeg = dragon.headingDeg;
      s.speedKmh = dragon.airspeed * 3.6;
      s.altitude = dragon.altitude;
      s.agl = dragon.agl;
      s.verticalSpeed = dragon.velocity.y;
      s.stamina = dragon.stamina;
      s.mode = dragon.mode;
    } else {
      s.valid = true;
      s.x = camera.position.x;
      s.y = camera.position.y;
      s.z = camera.position.z;
      s.headingDeg = horizontal > 1e-3 ? Math.atan2(this.viewDir.x, -this.viewDir.z) * RAD : 0;
      s.speedKmh = 0;
      s.altitude = camera.position.y;
      s.agl = camera.position.y;
      s.verticalSpeed = 0;
      s.stamina = 1;
      s.mode = 'hovering';
    }
    s.viewHeadingDeg = horizontal > 0.15 ? Math.atan2(this.viewDir.x, -this.viewDir.z) * RAD : s.headingDeg;
    if (s.viewHeadingDeg < 0) {
      s.viewHeadingDeg += 360;
    }
  }

  /** Hover controls when a hover starts; the cinematic camera's shot caption. */
  private updateContextHints(ctx: EngineContext): void {
    const mode = ctx.services.tryGet('dragon')?.mode ?? null;
    if (mode !== this.lastFlightMode) {
      if (mode === 'hovering') {
        this.hints.hide();
        this.hoverHints.show();
      } else if (this.lastFlightMode === 'hovering') {
        this.hoverHints.hide();
      }
      this.lastFlightMode = mode;
    }
    this.shotCaption.update(ctx.services.tryGet('cameraRig')?.shotLabel ?? '');
  }

  private handleInput(ctx: EngineContext): void {
    const input = ctx.input;
    if (this.modal !== 'none') {
      if (input.lastDevice === 'gamepad' && (input.wasPressed('pause') || (this.modal === 'map' && input.wasPressed('map')))) {
        this.closeModal();
      }
      return;
    }
    if (!input.enabled) {
      return;
    }
    if (input.wasPressed('pause')) {
      if (this.photo) {
        this.setPhoto(false);
      } else if (this.help.opened) {
        this.help.setOpen(false);
      } else {
        this.openModal('pause');
      }
    } else if (input.wasPressed('map') && !this.photo) {
      this.openModal('map');
    } else if (input.wasPressed('help') && !this.photo) {
      this.help.setOpen(!this.help.opened);
      this.hints.hide();
      this.hoverHints.hide();
    } else if (input.wasPressed('photo')) {
      this.setPhoto(!this.photo);
    } else if (input.wasPressed('hud') && !this.photo) {
      this.hudOff = !this.hudOff;
      this.toasts.push(this.hudOff ? 'Arayüz gizlendi · geri getirmek için U' : 'Arayüz gösteriliyor');
    }
  }

  /* ---------------- modals ---------------- */

  private openModal(kind: Exclude<Modal, 'none'>, tab?: MenuTab): void {
    const ctx = this.ctx;
    if (this.photo) {
      this.setPhoto(false);
    }
    if (this.modal === 'none') {
      this.pausedBeforeModal = ctx.time.paused;
    } else if (this.modal !== kind) {
      this.pauseMenu.close();
      this.fullMap.close();
    }
    this.modal = kind;
    this.reenableInputFrame = -1;
    ctx.input.enabled = false;
    ctx.input.exitPointerLock();
    ctx.events.emit('pause', { paused: true });
    this.help.setOpen(false);
    this.hints.hide();
    this.root.classList.toggle('is-modal', true);
    if (kind === 'pause') {
      this.settings.refresh();
      this.pauseMenu.setProgress(this.tracker.count, this.tracker.total);
      this.pauseMenu.open(tab);
    } else {
      this.fullMap.open(this.snapshot);
    }
  }

  private closeModal(): void {
    if (this.modal === 'none') {
      return;
    }
    this.pauseMenu.close();
    this.fullMap.close();
    this.modal = 'none';
    this.root.classList.toggle('is-modal', false);
    this.ctx.events.emit('pause', { paused: this.pausedBeforeModal });
    this.reenableInputFrame = this.ctx.time.frame + 1;
    this.ctx.input.requestPointerLock();
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.repeat || this.modal === 'none') {
      return;
    }
    const target = e.target as HTMLElement | null;
    if (target && target.tagName === 'INPUT' && e.code !== 'Escape') {
      return;
    }
    if (this.modal === 'pause' && (e.code === 'Escape' || e.code === 'KeyP')) {
      e.preventDefault();
      this.closeModal();
    } else if (this.modal === 'map') {
      if (e.code === 'Escape' || e.code === 'KeyM') {
        e.preventDefault();
        this.closeModal();
      } else if (this.fullMap.handleKey(e)) {
        e.preventDefault();
      }
    }
  }

  private onPointerLockChange(): void {
    const locked = document.pointerLockElement === this.ctx.canvas;
    if (!locked && this.started && this.modal === 'none' && !this.photo && document.hasFocus()) {
      this.openModal('pause');
    }
  }

  private setPhoto(on: boolean): void {
    if (on === this.photo) {
      return;
    }
    const ctx = this.ctx;
    const rig = ctx.services.tryGet('cameraRig');
    this.photo = on;
    if (on) {
      this.pausedBeforePhoto = ctx.time.paused;
      this.cameraBeforePhoto = rig?.mode ?? 'third';
      ctx.events.emit('pause', { paused: true });
      rig?.setMode('free');
      this.help.setOpen(false);
      this.hints.hide();
      this.tracker.card.hide();
    } else {
      rig?.setMode(this.cameraBeforePhoto === 'free' ? 'third' : this.cameraBeforePhoto);
      ctx.events.emit('pause', { paused: this.pausedBeforePhoto });
    }
    this.root.classList.toggle('is-photo', on);
    this.photoHint.setVisible(on && !ctx.debug.nohud);
  }

  private teleport(target: TeleportTarget): void {
    this.closeModal();
    this.tracker.card.hide();
    this.ctx.events.emit('teleport', { x: target.x, y: target.y, z: target.z, headingDeg: target.headingDeg, pitchDeg: target.pitchDeg });
    this.toasts.push(`Işınlanıldı · ${target.label}`);
    this.click();
  }

  private click(): void {
    this.ctx.services.tryGet('audio')?.play('ui-click', 0.6);
  }

  private installDebugHook(): void {
    const hook = {
      open: (what: UiDebugTarget): void => {
        if (what === 'map') {
          this.openModal('map');
        } else if (what === 'help') {
          this.help.setOpen(true);
        } else if (what === 'photo') {
          this.setPhoto(true);
        } else {
          this.openModal('pause', what === 'pause' ? 'settings' : what);
        }
      },
      close: (): void => {
        this.closeModal();
        this.help.setOpen(false);
        this.setPhoto(false);
      },
      discover: (id: string): boolean => this.tracker.force(id),
      toast: (text: string, kind?: 'info' | 'warn'): void => this.toasts.push(text, kind),
      resetDiscoveries: (): void => this.tracker.reset(),
      raster: this.raster,
      state: () => ({
        started: this.started,
        modal: this.modal,
        photo: this.photo,
        hudOff: this.hudOff,
        discovered: this.tracker.count,
        total: this.tracker.total,
        mapRaster: this.raster.image ? `${this.raster.image.width}x${this.raster.image.height}` : this.raster.pending ? 'building' : 'none',
      }),
    };
    (window as unknown as { __evrenUi: typeof hook }).__evrenUi = hook;
  }
}
