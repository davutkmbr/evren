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

export interface RigBuildOptions {
  renderer: THREE.WebGLRenderer;
  textureSize: number;
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
    buildRider(riderBuilder, this.skel);
    buildTack(riderBuilder, body, this.skel);
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
    this.membraneUniforms.uBillow.value.set(o.billowLeft, o.billowRight);
    this.membraneUniforms.uFlutter.value = o.flutter;
    this.membraneUniforms.uFlutterFreq.value = o.flutterFreq;
    this.membraneUniforms.uFoldSlack.value = o.foldSlack;
    if (keyLightDir && keyLightDir.lengthSq() > 1e-8) {
      this.membraneUniforms.uKeyLightDir.value.copy(keyLightDir).normalize();
    }
    this.riderUniforms.uAirspeed.value = o.airspeed;
    this.riderUniforms.uAirflow.value.copy(o.airflow);
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
    this.riderDepthMaterial.dispose();
    for (const rt of [...this.scaleTex.targets, ...this.membraneTex.targets]) {
      rt.dispose();
    }
    this.baker.dispose();
    this.skel.skeleton.dispose();
  }
}
