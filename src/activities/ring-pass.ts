/**
 * HDR pass that draws the race rings and beacon AFTER the clouds (order 160, the transparent-effects range).
 * Additive markers drawn in the main scene write no depth, so the cloud pass saw open sky behind them and painted
 * clouds over them. Here they are composited on top of the finished HDR image instead, with a manual soft depth test
 * against the scene depth: terrain and buildings still hide them, clouds do not (they are gameplay markers).
 */
import * as THREE from 'three';
import type { EngineContext, HdrPass, HdrPassInputs } from '../core/contracts';

const COPY_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const COPY_FRAG = /* glsl */ `
uniform sampler2D tColor;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(tColor, vUv);
}`;

const MARKER_VERT = /* glsl */ `
uniform vec3 uColor;
varying vec3 vColor;
varying float vViewZ;
void main() {
  vec4 p = vec4(position, 1.0);
#ifdef USE_INSTANCING
  p = instanceMatrix * p;
#endif
  vColor = uColor;
#ifdef USE_INSTANCING_COLOR
  vColor *= instanceColor;
#endif
#ifdef USE_COLOR
  vColor *= color;
#endif
  vec4 mv = modelViewMatrix * p;
  vViewZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const MARKER_FRAG = /* glsl */ `
uniform sampler2D tDepth;
uniform vec2 uInvSize;
uniform float uNear;
uniform float uFar;
uniform float uOpacity;
varying vec3 vColor;
varying float vViewZ;
void main() {
  // Scene depth is reversed-Z float (1 = near, 0 = far/sky).
  float d = texture2D(tDepth, gl_FragCoord.xy * uInvSize).r;
  float sceneZ = d <= 0.0 ? 1e9 : (uFar * uNear) / (d * (uFar - uNear) + uNear);
  // Soft edge where the ring passes into geometry (a few metres, wider far away where depth is coarse).
  float soft = max(1.5, vViewZ * 0.004);
  float vis = clamp((sceneZ - vViewZ) / soft + 0.5, 0.0, 1.0);
  if (vis <= 0.0) {
    discard;
  }
  gl_FragColor = vec4(vColor * (uOpacity * vis), 1.0);
}`;

/** Additive marker material with the manual depth test (instance colours and vertex colours multiply `color`). */
export function createMarkerMaterial(color: THREE.Color, vertexColors = false): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: MARKER_VERT,
    fragmentShader: MARKER_FRAG,
    uniforms: {
      uColor: { value: color.clone() },
      uOpacity: { value: 1 },
      tDepth: { value: null },
      uInvSize: { value: new THREE.Vector2(1, 1) },
      uNear: { value: 0.1 },
      uFar: { value: 1000 },
    },
    vertexColors,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

export class RingPass implements HdrPass {
  readonly name = 'race-rings';
  readonly order = 160;
  enabled = false;
  /** Holds the marker meshes; rendered with the main camera after the copy. */
  readonly scene = new THREE.Scene();
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly copyMaterial = new THREE.ShaderMaterial({
    vertexShader: COPY_VERT,
    fragmentShader: COPY_FRAG,
    uniforms: { tColor: { value: null } },
    depthTest: false,
    depthWrite: false,
  });

  constructor() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const quad = new THREE.Mesh(geometry, this.copyMaterial);
    quad.frustumCulled = false;
    this.quadScene.add(quad);
    this.quadScene.matrixWorldAutoUpdate = false;
  }

  render(renderer: THREE.WebGLRenderer, inputs: HdrPassInputs, output: THREE.WebGLRenderTarget, ctx: EngineContext): void {
    const camera = ctx.camera;
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
      if (m && m.isShaderMaterial && m.uniforms.tDepth) {
        m.uniforms.tDepth.value = inputs.depth;
        (m.uniforms.uInvSize.value as THREE.Vector2).set(1 / output.width, 1 / output.height);
        m.uniforms.uNear.value = camera.near;
        m.uniforms.uFar.value = camera.far;
      }
    });
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    this.copyMaterial.uniforms.tColor.value = inputs.color;
    renderer.setRenderTarget(output);
    renderer.render(this.quadScene, this.quadCamera);
    renderer.render(this.scene, camera);
    renderer.autoClear = autoClear;
  }

  dispose(): void {
    this.copyMaterial.dispose();
    (this.quadScene.children[0] as THREE.Mesh).geometry.dispose();
  }
}
