import * as THREE from 'three';
import type { DragonPose, DragonRig, DragonState } from '../../core/contracts';
import { buildBoneSpecs, HEAD_FWD, JAW_HINGE, LANDMARKS, RIDER, TAIL_JOINTS } from './anatomy';
import { DEFAULT_POSE, STANDING_ROOT_HEIGHT } from './constants';
import { buildSkeleton, type RigSkeleton } from './skeleton';
import { MeshBuilder, SkinAccumulator } from './geometry/buffers';
import { BodySurface } from './geometry/body';
import { buildFrillMembranes, buildHead, buildRictus } from './geometry/head';
import { buildWings } from './geometry/wings';
import { buildLegs } from './geometry/legs';
import { buildDorsalSpikes, buildTailSpade } from './geometry/spikes';
import { TextureBaker } from './materials/texture-baker';
import { bakeScaleTextures, type ScaleTextures } from './materials/scale-textures';
import { createBodyMaterial, type BodyMaterialUniforms } from './materials/body-material';
import { bakeMembraneTextures, type MembraneTextures } from './materials/membrane-textures';
import { createMembraneMaterial, type MembraneUniforms } from './materials/membrane-material';
import { DragonAnimator } from './animation/animator';
import type { SurfaceAnchor } from './animation/rider-pose';
import { buildRider, RIDER_HIDE_POINT } from './geometry/rider';
import { buildTack } from './geometry/tack';
import { createRiderMaterial, type RiderUniforms } from './materials/rider-material';
import { RiderCharacter } from './rider/character';
import { loadHumanRider, type HumanRider } from './rider/human';
import { RiderRetarget } from './rider/retarget';
import { DynamicReins } from './rider/reins';
import { LocomotionController } from './rider/locomotion/controller';
import { applyLook, loadRiderLook, type RiderLook } from './rider/look';
import type { RiderAppearance } from './rider/appearance';

export interface RigBuildOptions {
  renderer: THREE.WebGLRenderer;
  textureSize: number;
  /** The rebuilt rider (work in progress, `?rider=new`): replaces the old rider mesh; not animated yet. */
  newRider?: RiderAppearance;
  /** A rider glTF from the Blender pipeline (work in progress, `?rider=<url>`): replaces the old rider mesh. */
  humanRider?: string;
}

/** The hero textures are always seen at grazing angles up close: fixed anisotropy per size tier. */
function anisotropyFor(textureSize: number): number {
  return textureSize >= 2048 ? 8 : 4;
}

const BOUNDS = new THREE.Sphere(new THREE.Vector3(0, 0, 0.8), 15);
/**
 * Where the fire leaves the mouth, as a fraction of the way from the jaw hinge to the lips: inside the mouth cavity,
 * so the jet streams out between the open jaws instead of starting in front of the upper jaw.
 */
const MOUTH_DEPTH = 0.72;
const _jawHalf = new THREE.Quaternion();

/**
 * Petting stroke: a line on the right side of the neck's top, just ahead of the saddle blanket (back to front), with
 * the skin weights of each point so the rider's palm can follow the surface as the neck moves.
 */
function buildPetTrack(body: BodySurface): SurfaceAnchor[] {
  const anchors: SurfaceAnchor[] = [];
  const acc = new SkinAccumulator();
  const n = 7;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const s = body.sAtZ(THREE.MathUtils.lerp(-3.22, -3.5, t));
    const theta = THREE.MathUtils.lerp(0.34, 0.3, t);
    body.skinForSurface(s, theta, acc);
    const bones: number[] = [];
    const weights: number[] = [];
    acc.resolve(bones, weights);
    anchors.push({ position: body.surfacePoint(s, theta), normal: body.surfaceNormal(s, theta), bones, weights });
  }
  return anchors;
}

function makeSkinned(geometry: THREE.BufferGeometry, material: THREE.Material, skel: RigSkeleton, name: string): THREE.SkinnedMesh {
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = name;
  mesh.bind(skel.skeleton, new THREE.Matrix4());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.boundingSphere = BOUNDS.clone();
  geometry.boundingSphere = BOUNDS.clone();
  return mesh;
}

/** The procedural dragon + rider: skinned meshes sharing one skeleton, animated procedurally from DragonPose. */
const _airflowWorld = new THREE.Vector3();
const _dragonHead = new THREE.Vector3();
const _ga = new THREE.Vector3();
const _gb = new THREE.Vector3();
const _gc = new THREE.Vector3();
const _gd = new THREE.Vector3();

export class DragonRigImpl implements DragonRig {
  readonly root = new THREE.Group();
  readonly riderHead = new THREE.Object3D();
  readonly mouth = new THREE.Object3D();
  readonly wingTipLeft = new THREE.Object3D();
  readonly wingTipRight = new THREE.Object3D();
  /**
   * standHeight: the rig origin is the body's centre of mass (anatomy.ts), and standing puts the feet on the ground
   * STANDING_ROOT_HEIGHT below it (the leg IK plants them there), so that is the standing COM height flight uses.
   */
  readonly dimensions: DragonRig['dimensions'] = { length: 18.3, wingspan: 24, height: 4.4, standHeight: STANDING_ROOT_HEIGHT };
  readonly skel: RigSkeleton;
  readonly stats = { bodyTriangles: 0, membraneTriangles: 0, riderTriangles: 0, bones: 0 };
  private readonly pose: DragonPose = { ...DEFAULT_POSE };
  private readonly animator: DragonAnimator;
  private readonly baker: TextureBaker;
  private scaleTex: ScaleTextures;
  private membraneTex: MembraneTextures;
  private readonly bodyMaterial: THREE.MeshPhysicalMaterial;
  private readonly bodyDepthMaterial: THREE.MeshDepthMaterial;
  private readonly bodyUniforms: BodyMaterialUniforms;
  private readonly membraneMaterial: THREE.MeshStandardMaterial;
  private readonly membraneDepthMaterial: THREE.MeshDepthMaterial;
  private readonly membraneUniforms: MembraneUniforms;
  private readonly riderMaterial: THREE.MeshStandardMaterial;
  private readonly riderDepthMaterial: THREE.MeshDepthMaterial;
  private readonly riderUniforms: RiderUniforms;
  /** The rebuilt rider when enabled (see RigBuildOptions.newRider). */
  character?: RiderCharacter;
  /** The Blender-pipeline rider while / after it loads. */
  humanLoading?: Promise<HumanRider>;
  human?: HumanRider;
  /** Drives the human rider from the procedural rider bones. */
  riderRetarget?: RiderRetarget;
  /** The reins' free spans, simulated (with the human rider). */
  reins?: DynamicReins;
  /** The rider's look (applied once the character has loaded; the Binici menu changes it). */
  riderLook: RiderLook = loadRiderLook();
  /** The rider on foot (or in the air) after leaving the saddle; the caller drives it. */
  onFoot?: LocomotionController;
  private readonly meshes: THREE.SkinnedMesh[] = [];
  private firstPerson = false;
  private textureSize: number;
  /** Mouth anchor inputs (head bone frame): the lips at rest and the jaw hinge. */
  private readonly jaw: THREE.Bone;
  private readonly mouthRest = new THREE.Vector3();
  private readonly jawHinge = new THREE.Vector3();
  private readonly eyeRest = new THREE.Vector3();

  constructor(opts: RigBuildOptions) {
    this.root.name = 'dragon-rig';
    this.skel = buildSkeleton(buildBoneSpecs());
    this.root.add(this.skel.rootBone);
    this.stats.bones = this.skel.bones.length;

    this.textureSize = opts.textureSize;
    this.baker = new TextureBaker(opts.renderer);
    this.scaleTex = bakeScaleTextures(this.baker, opts.textureSize, anisotropyFor(opts.textureSize));
    this.membraneTex = bakeMembraneTextures(this.baker, opts.textureSize, anisotropyFor(opts.textureSize));

    const body = new BodySurface(this.skel);
    const bodyBuilder = new MeshBuilder();
    const membraneBuilder = new MeshBuilder();
    body.build(bodyBuilder);
    const head = buildHead(bodyBuilder, body, this.skel);
    buildRictus(bodyBuilder, body, this.skel);
    const wings = buildWings(body, bodyBuilder, membraneBuilder, this.skel);
    buildFrillMembranes(membraneBuilder, head, this.skel);
    buildLegs(bodyBuilder, this.skel);
    buildDorsalSpikes(bodyBuilder, body);
    buildTailSpade(bodyBuilder, body);

    const bodyMat = createBodyMaterial(this.scaleTex);
    this.bodyMaterial = bodyMat.material;
    this.bodyDepthMaterial = bodyMat.depthMaterial;
    this.bodyUniforms = bodyMat.uniforms;
    const memMat = createMembraneMaterial(this.membraneTex);
    this.membraneMaterial = memMat.material;
    this.membraneDepthMaterial = memMat.depthMaterial;
    this.membraneUniforms = memMat.uniforms;

    const bodyMesh = makeSkinned(bodyBuilder.build(), this.bodyMaterial, this.skel, 'dragon-body');
    bodyMesh.customDepthMaterial = this.bodyDepthMaterial;
    const memGeo = membraneBuilder.build();
    memGeo.deleteAttribute('tangent');
    const membraneMesh = makeSkinned(memGeo, this.membraneMaterial, this.skel, 'dragon-membrane');
    membraneMesh.customDepthMaterial = this.membraneDepthMaterial;
    const riderBuilder = new MeshBuilder();
    if (!opts.newRider && !opts.humanRider) {
      buildRider(riderBuilder, this.skel);
    }
    const tack = buildTack(riderBuilder, body, this.skel, { dynamicReins: !!opts.humanRider });
    const riderMat = createRiderMaterial(RIDER_HIDE_POINT);
    this.riderMaterial = riderMat.material;
    this.riderDepthMaterial = riderMat.depthMaterial;
    this.riderUniforms = riderMat.uniforms;
    const riderGeo = riderBuilder.build();
    riderGeo.deleteAttribute('tangent');
    const riderMesh = makeSkinned(riderGeo, this.riderMaterial, this.skel, 'dragon-rider');
    riderMesh.customDepthMaterial = this.riderDepthMaterial;
    this.stats.riderTriangles = riderBuilder.triangleCount;
    this.meshes.push(bodyMesh, membraneMesh, riderMesh);
    this.root.add(bodyMesh, membraneMesh, riderMesh);
    this.stats.bodyTriangles = bodyBuilder.triangleCount;
    this.stats.membraneTriangles = membraneBuilder.triangleCount;

    if (tack.reins) {
      this.reins = new DynamicReins(tack.reins, this.skel, this.root);
    }
    if (opts.humanRider) {
      this.humanLoading = loadHumanRider(opts.humanRider, this.skel.bone('chest'), LANDMARKS.chest).then((h) => {
        console.info(`[rider] loaded ${opts.humanRider}: ${h.meshes.length} meshes, ${h.wind.chains.length} wind chains`);
        this.human = h;
        applyLook(h, this.riderLook);
        this.root.updateMatrixWorld(true);
        this.riderRetarget = new RiderRetarget(this.skel, h.bones, this.root, h.bindLocal);
        this.riderRetarget.setFirstPerson(this.firstPerson);
        if (this.reins) {
          const rt = this.riderRetarget;
          const skel = this.skel;
          const left: THREE.Vector3[] = [];
          this.reins.fistPath = (side, out) => {
            rt.fistPath(side, out);
            if (side === 'R') {
              // The right rein goes to the left fist while the right hand is busy (the rig moves its grip bone there).
              skel.bone('riderReinR').getWorldPosition(_ga);
              skel.bone('riderHandR').getWorldPosition(_gb);
              skel.bone('riderHandL').getWorldPosition(_gc);
              const busy = THREE.MathUtils.clamp(_ga.distanceTo(_gb) / Math.max(_gb.distanceTo(_gc), 1e-3), 0, 1);
              if (busy > 1e-3) {
                rt.fistPath('L', left);
                out.forEach((p, i) => p.lerp(left[i].clone().add(_gd.set(0, 0.012, 0)), busy));
              }
            }
            return out;
          };
        }
        return h;
      });
    }
    if (opts.newRider) {
      this.character = new RiderCharacter({ anchor: this.skel.bone('chest'), anchorRest: LANDMARKS.chest, meshParent: this.root }, opts.newRider);
      console.info(`[rider] ${this.character.stats.triangles} tris in ${this.character.stats.ms.toFixed(0)} ms`);
    }

    // Anchors.
    const headBone = this.skel.bone('head');
    this.jaw = this.skel.bone('jaw');
    this.mouthRest.copy(head.mouthPoint).sub(LANDMARKS.skullBase);
    this.jawHinge.copy(JAW_HINGE).sub(LANDMARKS.skullBase);
    this.mouth.position.copy(head.mouthPoint).sub(LANDMARKS.skullBase);
    this.mouth.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), HEAD_FWD);
    headBone.add(this.mouth);
    const riderHeadBone = this.skel.bone('riderHead');
    this.riderHead.position.copy(RIDER.eye).sub(RIDER.head);
    this.eyeRest.copy(this.riderHead.position);
    // The rider looks forward along the neck, slightly down (hands, reins and the dragon's head in view).
    this.riderHead.rotation.set(THREE.MathUtils.degToRad(-8), 0, 0);
    riderHeadBone.add(this.riderHead);
    const tipR = this.skel.bone('finger0bR');
    const tipL = this.skel.bone('finger0bL');
    this.wingTipRight.position.copy(wings.tips.R).sub(this.skel.restHeads[this.skel.id('finger0bR')]);
    this.wingTipLeft.position.copy(wings.tips.L).sub(this.skel.restHeads[this.skel.id('finger0bL')]);
    tipR.add(this.wingTipRight);
    tipL.add(this.wingTipLeft);

    const tailEnd = TAIL_JOINTS[TAIL_JOINTS.length - 1].z + 0.55;
    this.dimensions.length = Math.round((tailEnd - LANDMARKS.snoutTip.z) * 10) / 10;
    this.dimensions.wingspan = Math.round(Math.abs(wings.tips.R.x - wings.tips.L.x) * 10) / 10;
    // Standing: feet at -STANDING_ROOT_HEIGHT, crown of the raised head ~2.1 m above the rig origin.
    this.dimensions.height = Math.round((STANDING_ROOT_HEIGHT + 2.1) * 10) / 10;

    this.animator = new DragonAnimator(this.skel);
    this.animator.setPetTrack(buildPetTrack(body));
    this.applyPose(0, undefined);
  }

  /** Side the head comes round on when the dragon looks back at the rider: +1 left, -1 right. */
  setGazeSide(side: number, immediate = false): void {
    this.animator.setGazeSide(side, immediate);
  }

  /** Petting contact of the last applyPose (headless checks): wrist reach error and palm gap to the skin (m). */
  get petContact(): Readonly<{ active: boolean; error: number; gap: number }> {
    return this.animator.petContact;
  }

  /** Debug (screenshots): freeze the petting stroke phase (rad); null = animate. */
  setDebugStrokePhase(stroke: number | null): void {
    this.animator.setDebugStrokePhase(stroke);
  }

  setPose(p: Partial<DragonPose>): void {
    const target = this.pose as unknown as Record<string, number>;
    const src = p as Record<string, number | undefined>;
    for (const key in src) {
      const v = src[key];
      if (typeof v === 'number' && Number.isFinite(v) && key in target) {
        target[key] = v;
      }
    }
  }

  getPose(): Readonly<DragonPose> {
    return this.pose;
  }

  setFirstPerson(enabled: boolean): void {
    this.firstPerson = enabled;
    this.riderUniforms.uFirstPerson.value = enabled ? 1 : 0;
    this.animator.setFirstPerson(enabled);
    this.riderRetarget?.setFirstPerson(enabled);
  }

  /**
   * The rider leaves the saddle: the character keeps its pose, moves under `parent` (the world), faces the dragon's
   * heading and flies off with `velocity` (world m/s: the dragon's own plus the leap) under a locomotion controller,
   * returned for the caller to drive (input: glide to spread the wings). The reins stay on the saddle.
   */
  leaveSaddle(parent: THREE.Object3D, velocity: THREE.Vector3, ground?: (x: number, z: number) => number): LocomotionController | undefined {
    const h = this.human;
    if (!h || !this.riderRetarget || this.onFoot) {
      return this.onFoot;
    }
    this.riderRetarget.enabled = false;
    if (this.reins) {
      this.reins.fistPath = undefined;
    }
    parent.attach(h.root);
    const q = h.root.getWorldQuaternion(new THREE.Quaternion());
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const yaw = Math.atan2(fwd.x, fwd.z);
    h.root.rotation.set(0, yaw, 0, 'YXZ');
    h.mixer.stopAllAction();
    this.onFoot = new LocomotionController(h, h.root, ground);
    this.onFoot.launch(velocity, yaw);
    return this.onFoot;
  }

  /** Sets the rider's look (headwear, hair, face, palette ...); applies now if the character is loaded. */
  setRiderLook(look: RiderLook): void {
    this.riderLook = look;
    if (this.human) {
      applyLook(this.human, look);
    }
  }

  /**
   * The rider climbs back into the saddle (the caller has brought them beside the dragon): over `duration` the on-foot
   * pose blends into the riding pose while the hips travel up to the seat on an arc; then the rig drives the rider
   * again (retarget, reins). False when the rider is not on foot.
   */
  mountRider(duration = 1.1): boolean {
    const h = this.human;
    if (!h || !this.onFoot || !h.saddle || !this.riderRetarget) {
      return false;
    }
    const snap = new Map<THREE.Bone, THREE.Quaternion>();
    for (const b of h.bones.values()) {
      snap.set(b, b.quaternion.clone());
    }
    const hips = h.bones.get('Hips')!;
    const hipsWorld = hips.getWorldPosition(new THREE.Vector3());
    const hipsWorldQ = hips.getWorldQuaternion(new THREE.Quaternion());
    h.mixer.stopAllAction();
    h.saddle.anchor.add(h.root);
    h.root.position.copy(h.saddle.position);
    h.root.quaternion.copy(h.saddle.quaternion);
    h.root.scale.set(1, 1, 1);
    h.wings.set(0);
    this.onFoot = undefined;
    this.riderRetarget.enabled = true;
    if (this.reins) {
      const rt = this.riderRetarget;
      const own = (side: 'L' | 'R', out: THREE.Vector3[]): THREE.Vector3[] => rt.fistPath(side, out);
      this.reins.fistPath = own;
    }
    this.mounting = { t: 0, duration, snap, hipsWorld, hipsWorldQ };
    return true;
  }

  private mounting?: { t: number; duration: number; snap: Map<THREE.Bone, THREE.Quaternion>; hipsWorld: THREE.Vector3; hipsWorldQ: THREE.Quaternion };

  /** Blends the start of a mount (the pose the rider stood in) into the riding pose the retarget just set. */
  private blendMount(dt: number): void {
    const m = this.mounting;
    const h = this.human;
    if (!m || !h) {
      return;
    }
    m.t += dt;
    const u = Math.min(1, m.t / m.duration);
    const k = u * u * (3 - 2 * u);
    const hips = h.bones.get('Hips')!;
    const targetPos = hips.position.clone();
    const targetQ = hips.quaternion.clone();
    for (const [b, q] of m.snap) {
      if (b !== hips) {
        b.quaternion.copy(q).slerp(b.quaternion, k);
      }
    }
    // The hips from where they were (in the world) to the seat, lifted on the way (a step up and a swing over).
    const parent = hips.parent!;
    parent.updateWorldMatrix(true, false);
    const startPos = parent.worldToLocal(m.hipsWorld.clone());
    const pq = parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    const startQ = pq.multiply(m.hipsWorldQ);
    hips.position.lerpVectors(startPos, targetPos, k);
    hips.position.y += 0.45 * Math.sin(Math.PI * u);
    hips.quaternion.copy(startQ).slerp(targetQ, k);
    if (u >= 1) {
      this.mounting = undefined;
    }
  }

  get isFirstPerson(): boolean {
    return this.firstPerson;
  }

  /**
   * Advances procedural animation (call once per frame). `keyLightDir` = world direction toward the shadow-casting
   * light, `wind` = world wind (m/s); both optional.
   */
  applyPose(dt: number, state: DragonState | undefined, keyLightDir?: THREE.Vector3 | null, wind?: THREE.Vector3 | null): void {
    this.animator.setAngularVelocity(state ? state.angularVelocity : null);
    this.animator.setWind(wind ?? null);
    this.animator.update(this.pose, dt, state);
    this.riderHead.position.copy(this.eyeRest).add(this.animator.povEyeOffset);
    // The fire's source sits halfway between the jaws (half the jaw's opening about the hinge), inside the mouth; the
    // jet keeps the head's aim.
    _jawHalf.identity().slerp(this.jaw.quaternion, 0.5);
    this.mouth.position.copy(this.mouthRest).sub(this.jawHinge).multiplyScalar(MOUTH_DEPTH).applyQuaternion(_jawHalf).add(this.jawHinge);
    const o = this.animator.outputs;
    this.bodyUniforms.uBreath.value = o.breath;
    const pose = this.pose;
    this.bodyUniforms.uEyeLid.value = THREE.MathUtils.clamp(pose.eyeLid ?? 0, 0, 1);
    this.bodyUniforms.uPupil.value = THREE.MathUtils.clamp(pose.pupil ?? 0.3, 0, 1);
    this.bodyUniforms.uPlates.value = THREE.MathUtils.clamp(pose.neckPlates ?? 0, 0, 1);
    this.membraneUniforms.uBillow.value.set(o.billowLeft, o.billowRight);
    this.membraneUniforms.uFlutter.value = o.flutter;
    this.membraneUniforms.uFlutterFreq.value = o.flutterFreq;
    this.membraneUniforms.uFoldSlack.value = o.foldSlack;
    if (keyLightDir && keyLightDir.lengthSq() > 1e-8) {
      this.membraneUniforms.uKeyLightDir.value.copy(keyLightDir).normalize();
    }
    this.riderUniforms.uAirspeed.value = o.airspeed;
    this.riderUniforms.uAirflow.value.copy(o.airflow);
    if (!this.human || this.onFoot) {
      this.reins?.update(dt);
    } else {
      this.riderRetarget?.update();
      this.blendMount(dt);
      this.reins?.update(dt);
      // Face: laughs with the dragon, shouts with the roar, set jaw in a tuck, a soft smile while petting; meets the
      // dragon's eyes when it looks back.
      const pose = this.pose;
      const lookBack = (pose.gazeRider ?? 0) > 0.3;
      if (lookBack) {
        this.skel.bone('head').getWorldPosition(_dragonHead);
      }
      this.human.face.update(
        dt,
        { laugh: pose.riderLaugh ?? 0, shout: pose.riderCheer ?? 0, effort: (pose.riderTuck ?? 0) * 0.8, smile: (pose.riderPet ?? 0) * 0.6 },
        lookBack ? _dragonHead : null,
      );
      _airflowWorld.copy(o.airflow).transformDirection(this.root.matrixWorld);
      this.human.wind.update(dt, o.airspeed, _airflowWorld);
    }
    if (this.character) {
      this.character.uniforms.uAirspeed.value = o.airspeed;
      this.character.uniforms.uAirflow.value.copy(o.airflow);
    }
  }

  /** Re-bakes the procedural textures when the quality preset changes the texture size. */
  setTextureQuality(size: number): void {
    if (size === this.textureSize) {
      return;
    }
    this.textureSize = size;
    const anisotropy = anisotropyFor(size);
    const oldTargets = [...this.scaleTex.targets, ...this.membraneTex.targets];
    this.scaleTex = bakeScaleTextures(this.baker, size, anisotropy);
    this.membraneTex = bakeMembraneTextures(this.baker, size, anisotropy);
    const m = this.bodyMaterial;
    m.map = this.scaleTex.albedo;
    m.normalMap = this.scaleTex.normal;
    m.roughnessMap = this.scaleTex.orm;
    m.aoMap = this.scaleTex.orm;
    this.membraneMaterial.normalMap = this.membraneTex.normal;
    this.membraneUniforms.tMembrane.value = this.membraneTex.data;
    for (const rt of oldTargets) {
      rt.dispose();
    }
  }

  dispose(): void {
    for (const m of this.meshes) {
      m.geometry.dispose();
    }
    this.bodyMaterial.dispose();
    this.bodyDepthMaterial.dispose();
    this.membraneMaterial.dispose();
    this.membraneDepthMaterial.dispose();
    this.riderMaterial.dispose();
    this.character?.dispose();
    this.reins?.dispose();
    this.riderDepthMaterial.dispose();
    for (const rt of [...this.scaleTex.targets, ...this.membraneTex.targets]) {
      rt.dispose();
    }
    this.baker.dispose();
    this.skel.skeleton.dispose();
  }
}
