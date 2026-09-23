import * as THREE from 'three';
import type { CameraMode, CameraRigState, District, DragonState, EngineContext, GeoQuery, LandmarkDef, RoadDef, System, Vec2Like } from '../../core/contracts';
import { LandUse, UpdateOrder } from '../../core/contracts';
import { WORLD_BOUNDS } from '../../core/geo-coords';
import type { AudioDebugHandle } from '../index';
import { loadVolume } from '../settings';

/**
 * Interactive sandbox harness: fake dragon / camera / geo services driven by sliders so every audio
 * behaviour can be auditioned in isolation (click anywhere first to unlock audio).
 */
export interface LiveState {
  airspeed: number;
  aoaDeg: number;
  turn: number;
  altitude: number;
  urban: number;
  coast: number;
  firing: boolean;
  diving: boolean;
  pov: boolean;
}

const STYLE = `
.al-panel { position:absolute; top:16px; left:16px; width:320px; pointer-events:auto; background:rgba(12,14,18,0.92);
  border:1px solid #232830; border-radius:12px; padding:14px 16px; color:#d9dde3;
  font: 12.5px/1.4 -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif; }
.al-panel h2 { margin:0 0 4px; font-size:14px; font-weight:600; color:#f1f3f5; }
.al-hint { color:#8b939e; margin:0 0 10px; }
.al-row { display:grid; grid-template-columns: 92px 1fr 44px; align-items:center; gap:8px; margin:6px 0; }
.al-row span:last-child { text-align:right; font-variant-numeric: tabular-nums; color:#aeb5bf; }
.al-row input { width:100%; accent-color:#e0763a; }
.al-btns { display:flex; flex-wrap:wrap; gap:6px; margin-top:10px; }
.al-btn { cursor:pointer; border:1px solid #2a3039; background:#171c22; color:#cfd5dc; border-radius:6px; padding:5px 10px; font-size:12px; }
.al-btn:hover { background:#1f252d; border-color:#3a424d; }
.al-btn[aria-pressed="true"] { background:#3a2416; border-color:#e0763a; color:#ffd2b3; }
.al-meter { height:8px; border-radius:4px; background:#1a1f26; overflow:hidden; margin-top:10px; }
.al-meter i { display:block; height:100%; width:0; background:linear-gradient(90deg,#3fb27f,#e3a33b 70%,#ff5b4f); }
.al-status { margin-top:8px; color:#8b939e; font-variant-numeric: tabular-nums; }
`;

class FakeGeo implements GeoQuery {
  bounds = WORLD_BOUNDS;
  landmarks: LandmarkDef[] = [];
  roads: RoadDef[] = [];
  smallMosqueSites: GeoQuery['smallMosqueSites'] = [];
  coastlines: Vec2Like[][] = [];
  districts: District[] = [];
  heightGrid = { data: new Float32Array(1), width: 1, height: 1, cellSize: 1, originX: 0, originZ: 0 };
  landUseGrid = { data: new Uint8Array(1), width: 1, height: 1, cellSize: 1, originX: 0, originZ: 0 };
  constructor(private readonly state: LiveState) {}
  heightAt(): number {
    return 0;
  }
  normalAt(_x: number, _z: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, 1, 0);
  }
  isWater(x: number): boolean {
    return this.state.coast > 0.5 && x > 0;
  }
  coastDistance(): number {
    return this.state.coast > 0.01 ? (1 - this.state.coast) * 900 : 5000;
  }
  landUseAt(x: number): LandUse {
    return this.isWater(x) ? LandUse.Water : this.state.urban > 0.3 ? LandUse.Urban : LandUse.Park;
  }
  densityAt(): number {
    return this.state.urban;
  }
  districtAt(): District | null {
    return null;
  }
  buildableAt(): boolean {
    return true;
  }
  landmark(): LandmarkDef | undefined {
    return undefined;
  }
  getHeightTexture(): THREE.DataTexture {
    return new THREE.DataTexture(new Float32Array([0]), 1, 1, THREE.RedFormat, THREE.FloatType);
  }
  getLandUseTexture(): THREE.DataTexture {
    return new THREE.DataTexture(new Uint8Array([2]), 1, 1, THREE.RedFormat, THREE.UnsignedByteType);
  }
  getCoastDistanceTexture(): THREE.DataTexture {
    return new THREE.DataTexture(new Float32Array([100]), 1, 1, THREE.RedFormat, THREE.FloatType);
  }
}

export function createLiveHarness(state: LiveState): System {
  const object = new THREE.Group();
  const dragon: DragonState = {
    object,
    position: object.position,
    quaternion: object.quaternion,
    velocity: new THREE.Vector3(),
    angularVelocity: new THREE.Vector3(),
    mode: 'flying',
    airspeed: 0,
    altitude: 0,
    agl: 0,
    headingDeg: 0,
    gForce: 1,
    stamina: 1,
    flapEffort: 0,
    firing: false,
    touchingWater: false,
  };
  const rigState: CameraRigState = {
    mode: 'third',
    fovDeg: 60,
    setMode(m: CameraMode) {
      rigState.mode = m;
    },
    shake() {},
  };
  const body = new THREE.Mesh(new THREE.ConeGeometry(1.5, 12, 12).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x6b4a3a, roughness: 0.7 }));
  object.add(body);
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const fwd = new THREE.Vector3();
  const up = new THREE.Vector3();
  let heading = 0;
  let meter: HTMLElement | null = null;
  let status: HTMLElement | null = null;
  let analyser: AnalyserNode | null = null;
  const buf = new Float32Array(1024);

  return {
    name: 'audio-live',
    order: UpdateOrder.Physics,
    init(ctx: EngineContext): void {
      ctx.scene.add(object);
      ctx.scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x5a4a3a, 2.2));
      const sun = new THREE.DirectionalLight(0xfff0dd, 2.5);
      sun.position.set(200, 300, 100);
      ctx.scene.add(sun);
      ctx.scene.background = new THREE.Color(0x8fb4dc);
      const grid = new THREE.GridHelper(4000, 80, 0x3d4a58, 0x5d6b7a);
      ctx.scene.add(grid);
      ctx.services.provide('dragon', dragon);
      ctx.services.provide('cameraRig', rigState);
      ctx.services.provide('geo', new FakeGeo(state));
      buildPanel(ctx, state);
      meter = ctx.uiRoot.querySelector('.al-meter i');
      status = ctx.uiRoot.querySelector('.al-status');
    },
    update(dt: number, ctx: EngineContext): void {
      const aoa = (state.aoaDeg * Math.PI) / 180;
      heading += state.turn * dt;
      euler.set(state.diving ? -0.9 : 0, heading, -state.turn * 0.8);
      object.quaternion.setFromEuler(euler);
      object.position.y = state.altitude;
      fwd.set(0, 0, -1).applyQuaternion(object.quaternion);
      up.set(0, 1, 0).applyQuaternion(object.quaternion);
      dragon.velocity.copy(fwd).multiplyScalar(state.airspeed * Math.cos(aoa)).addScaledVector(up, -state.airspeed * Math.sin(aoa));
      dragon.airspeed = state.airspeed;
      dragon.angularVelocity.set(0, -state.turn, 0);
      dragon.mode = state.diving ? 'diving' : state.airspeed < 10 ? 'hovering' : 'flying';
      dragon.firing = state.firing;
      dragon.altitude = state.altitude;
      rigState.mode = state.pov ? 'pov' : 'third';
      const cam = ctx.camera;
      if (state.pov) {
        cam.position.copy(object.position).addScaledVector(up, 2.2).addScaledVector(fwd, -1.5);
        cam.quaternion.copy(object.quaternion);
      } else {
        cam.position.copy(object.position).addScaledVector(fwd, -28);
        cam.position.y += 7;
        cam.lookAt(object.position);
      }
      const handle = (window as unknown as { __ejderhaAudio?: AudioDebugHandle }).__ejderhaAudio;
      const engine = handle?.engine;
      if (engine && !analyser) {
        analyser = engine.ctx.createAnalyser();
        analyser.fftSize = 1024;
        engine.bus.output.connect(analyser);
      }
      if (analyser && meter) {
        analyser.getFloatTimeDomainData(buf);
        let peak = 0;
        for (let i = 0; i < buf.length; i++) {
          peak = Math.max(peak, Math.abs(buf[i]));
        }
        const db = 20 * Math.log10(Math.max(peak, 1e-5));
        meter.style.width = `${Math.max(0, Math.min(100, ((db + 60) / 60) * 100))}%`;
        if (status && engine) {
          status.textContent = `${handle?.context?.state ?? '-'} · tepe ${db.toFixed(1)} dBFS · aktif ses ${engine.stats.active}`;
        }
      }
    },
  };
}

function buildPanel(ctx: EngineContext, state: LiveState): void {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);
  const panel = document.createElement('div');
  panel.className = 'al-panel';
  panel.innerHTML = `<h2>Ses laboratuvarı</h2><p class="al-hint">Sesi açmak için bir kez tıklayın. Kaydırıcılar sahte uçuş durumunu sürer.</p>`;
  const slider = (label: string, key: keyof LiveState, min: number, max: number, step: number): void => {
    const row = document.createElement('label');
    row.className = 'al-row';
    const value = document.createElement('span');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(state[key]);
    value.textContent = String(state[key]);
    input.addEventListener('input', () => {
      (state as unknown as Record<string, number>)[key] = Number(input.value);
      value.textContent = input.value;
    });
    const name = document.createElement('span');
    name.textContent = label;
    row.append(name, input, value);
    panel.appendChild(row);
  };
  slider('Hız (m/s)', 'airspeed', 0, 110, 1);
  slider('Hücum açısı', 'aoaDeg', -10, 35, 1);
  slider('Dönüş (rad/s)', 'turn', -1, 1, 0.05);
  slider('İrtifa (m)', 'altitude', 5, 3000, 5);
  slider('Kentsel', 'urban', 0, 1, 0.05);
  slider('Kıyı', 'coast', 0, 1, 0.05);
  const btns = document.createElement('div');
  btns.className = 'al-btns';
  const button = (label: string, fn: (b: HTMLButtonElement) => void): void => {
    const b = document.createElement('button');
    b.className = 'al-btn';
    b.textContent = label;
    b.addEventListener('click', () => fn(b));
    btns.appendChild(b);
  };
  const toggle = (label: string, key: 'firing' | 'diving' | 'pov'): void =>
    button(label, (b) => {
      state[key] = !state[key];
      b.setAttribute('aria-pressed', String(state[key]));
    });
  button('Kükre', () => ctx.services.tryGet('audio')?.play('roar'));
  button('Kanat', () => ctx.events.emit('flap', { strength: 1 }));
  button('Su', () => ctx.events.emit('splash', { position: ctx.services.get('dragon').position.clone(), strength: 1 }));
  button('İniş', () => ctx.events.emit('ground-impact', { position: ctx.services.get('dragon').position.clone(), speed: 14 }));
  button('Tık', () => ctx.services.tryGet('audio')?.play('ui-click'));
  button('Keşif', () => ctx.events.emit('landmark-discovered', { id: 'test' }));
  toggle('Ateş', 'firing');
  toggle('Dalış', 'diving');
  toggle('POV', 'pov');
  let paused = false;
  button('Duraklat', (b) => {
    paused = !paused;
    b.setAttribute('aria-pressed', String(paused));
    ctx.events.emit('pause', { paused });
  });
  panel.appendChild(btns);
  const vol = document.createElement('label');
  vol.className = 'al-row';
  const startVolume = loadVolume();
  vol.innerHTML = `<span>Ana ses</span><input type="range" min="0" max="1" step="0.01" value="${startVolume}"><span>${startVolume.toFixed(2)}</span>`;
  const volInput = vol.querySelector('input')!;
  volInput.addEventListener('input', () => {
    ctx.services.tryGet('audio')?.setMasterVolume(Number(volInput.value));
    vol.querySelector('span:last-child')!.textContent = Number(volInput.value).toFixed(2);
  });
  panel.appendChild(vol);
  const meter = document.createElement('div');
  meter.className = 'al-meter';
  meter.innerHTML = '<i></i>';
  panel.appendChild(meter);
  const status = document.createElement('div');
  status.className = 'al-status';
  status.textContent = 'kilitli: tıklayın';
  panel.appendChild(status);
  ctx.uiRoot.appendChild(panel);
}
