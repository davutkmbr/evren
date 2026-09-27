"""
Procedural clip authoring for the rider skeleton (Mixamo names), baked into Blender actions (30 fps) and exported with
the character. Every clip is a function of time that poses the body with forward kinematics computed here (no scene
updates): the pelvis and the feet follow trajectories (the feet planted while they carry weight, legs by two-bone IK),
the spine, head and arms follow phase curves. Looping clips are exactly periodic (the last frame is the first).

Axes (Blender): +X the character's left, -Y forward, +Z up; the ground is z = 0. In-place clips: the body stays over
the origin and the stance foot slides back at the clip's speed, so the game moves the character at that speed
(CLIPS below, mirrored in src/dragon/model/rider/locomotion/clips.ts).

The numbers are chosen for weight: the pelvis drops into each contact and rises over the stance leg (walk), or
compresses at mid-stance and floats in the flight phase (run); arms swing against the legs; the chest counter-rotates
the pelvis; the head stays level; every change is eased (no linear motion in the body).
"""
import math

import bpy
from mathutils import Matrix, Vector

FPS = 30

# name: (seconds, loop, speed m/s): the game side reads the same table.
CLIPS = {
    "idle": (4.0, True, 0.0),
    "walk": (1.08, True, 1.45),
    "run": (0.7, True, 5.2),
    "crouch_idle": (3.0, True, 0.0),
    "crouch_walk": (1.3, True, 1.0),
    "run_stop": (0.9, False, 0.0),
    "jump_start": (0.28, False, 0.0),
    "jump_rise": (1.0, True, 0.0),
    "jump_fall": (1.0, True, 0.0),
    "jump_land": (0.55, False, 0.0),
    "glide": (2.4, True, 0.0),
    "idle_look": (5.0, False, 0.0),
    "idle_shoulders": (4.0, False, 0.0),
}

X = Vector((1, 0, 0))
Y = Vector((0, 1, 0))
Z = Vector((0, 0, 1))
FWD = Vector((0, -1, 0))
SIDES = (("Left", 1.0), ("Right", -1.0))


def ease(t):
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


def ease_out(t):
    t = min(1.0, max(0.0, t))
    return 1 - (1 - t) * (1 - t)


def ease_in(t):
    t = min(1.0, max(0.0, t))
    return t * t


def lerp(a, b, t):
    return a + (b - a) * t


def spring(t, freq=2.2, damp=0.35):
    """Unit step response of a damped spring (overshoots and settles): 0 at t=0 → 1."""
    w = 2 * math.pi * freq
    wd = w * math.sqrt(max(1e-6, 1 - damp * damp))
    return 1 - math.exp(-damp * w * t) * (math.cos(wd * t) + damp * w / wd * math.sin(wd * t))


class Skel:
    """Forward kinematics on the rest skeleton: pose matrices (armature space = world here) from local bases."""

    def __init__(self, rig):
        self.rig = rig
        self.bones = {}
        self.order = []
        for b in rig.data.bones:
            n = b.name.replace("mixamorig:", "")
            self.bones[n] = b
        for b in rig.data.bones:
            self.order.append(b.name.replace("mixamorig:", ""))
        self.parent = {n: (b.parent.name.replace("mixamorig:", "") if b.parent else None) for n, b in self.bones.items()}
        self.rest = {n: b.matrix_local.copy() for n, b in self.bones.items()}
        self.basis = {}
        self.cache = {}
        self.reset()

    def reset(self):
        self.basis = {n: Matrix.Identity(4) for n in self.bones}
        self.cache = {}

    def pose(self, n):
        m = self.cache.get(n)
        if m is None:
            p = self.parent[n]
            if p is None:
                m = self.rest[n] @ self.basis[n]
            else:
                m = self.pose(p) @ self.rest[p].inverted() @ self.rest[n] @ self.basis[n]
            self.cache[n] = m
        return m

    def head(self, n):
        return self.pose(n).translation.copy()

    def rest_head(self, n):
        return self.rest[n].translation.copy()

    def set_pose(self, n, m):
        p = self.parent[n]
        if p is None:
            local = self.rest[n]
        else:
            local = self.pose(p) @ self.rest[p].inverted() @ self.rest[n]
        self.basis[n] = local.inverted() @ m
        self.cache = {}

    def rotate(self, n, axis, angle, pivot=None):
        """Rotates the bone (and everything below it) about a world axis through its head (or a pivot)."""
        if abs(angle) < 1e-9:
            return
        m = self.pose(n)
        h = pivot if pivot is not None else m.translation
        r = Matrix.Translation(h) @ Matrix.Rotation(angle, 4, axis.normalized()) @ Matrix.Translation(-h)
        self.set_pose(n, r @ m)

    def translate(self, n, offset):
        m = self.pose(n).copy()
        m.translation = m.translation + offset
        self.set_pose(n, m)

    def aim(self, n, child, target):
        """Smallest rotation of `n` that brings its child's head onto the line toward target."""
        h = self.head(n)
        a = self.head(child) - h
        b = target - h
        if a.length < 1e-9 or b.length < 1e-9:
            return
        q = a.rotation_difference(b)
        m = self.pose(n)
        r = Matrix.Translation(h) @ q.to_matrix().to_4x4() @ Matrix.Translation(-h)
        self.set_pose(n, r @ m)

    def orient(self, n, rot3):
        """World rotation of the bone = rot3 applied to its rest orientation (position unchanged)."""
        m = self.pose(n)
        new = (rot3 @ self.rest[n].to_3x3()).to_4x4()
        new.translation = m.translation
        self.set_pose(n, new)

    def two_bone(self, upper, lower, end, target, pole):
        a = self.head(upper)
        l1 = (self.head(lower) - a).length
        l2 = (self.head(end) - self.head(lower)).length
        d = target - a
        dist = min(max(d.length, abs(l1 - l2) + 1e-4), (l1 + l2) * 0.9995)
        dn = d.normalized()
        n = pole - a
        n = n - dn * n.dot(dn)
        n = n.normalized() if n.length > 1e-9 else Vector((0, -1, 0))
        cos_a = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)
        sin_a = math.sqrt(max(0.0, 1 - cos_a * cos_a))
        mid = a + dn * (cos_a * l1) + n * (sin_a * l1)
        self.aim(upper, lower, mid)
        self.aim(lower, end, a + dn * dist)


class Body:
    """Posing helpers for the character (rest measurements taken from the skeleton)."""

    def __init__(self, sk):
        self.sk = sk
        self.hips0 = sk.rest_head("Hips")
        self.ankle0 = {s: sk.rest_head(s + "Foot") for s, _ in SIDES}
        self.ball0 = {s: sk.rest_head(s + "ToeBase") for s, _ in SIDES}
        self.foot_len = (self.ball0["Left"] - self.ankle0["Left"]).length  # ankle to ball
        self.ankle_h = self.ankle0["Left"].z
        self.stance_x = abs(self.ankle0["Left"].x)

    def start(self):
        self.sk.reset()

    # --- pelvis and trunk ---------------------------------------------------------------------------------------
    def pelvis(self, offset=Vector(), yaw=0.0, roll=0.0, pitch=0.0):
        """Moves the pelvis (and all above it) and turns it: yaw about Z, roll about the forward axis, pitch forward."""
        sk = self.sk
        sk.translate("Hips", offset)
        sk.rotate("Hips", Z, yaw)
        sk.rotate("Hips", Y, roll)
        sk.rotate("Hips", X, pitch)  # + = forward (the top toward -Y)

    def trunk(self, pitch=0.0, yaw=0.0, roll=0.0, split=(0.3, 0.35, 0.35)):
        """Bends the spine forward (pitch), twists (yaw) and side-bends (roll), spread over Spine, Spine1, Spine2."""
        for n, k in zip(("Spine", "Spine1", "Spine2"), split):
            self.sk.rotate(n, X, pitch * k)
            self.sk.rotate(n, Z, yaw * k)
            self.sk.rotate(n, Y, roll * k)

    def head_level(self, pitch=0.0, yaw=0.0, roll=0.0, neck_share=0.4):
        """Orients the head in the world (level = rest orientation) plus the given angles, split with the neck."""
        sk = self.sk
        # Undo whatever the trunk did, shared between neck and head.
        cur = sk.pose("Head").to_3x3() @ sk.rest["Head"].to_3x3().inverted()
        q = cur.inverted().to_quaternion()
        axis, ang = q.to_axis_angle()
        sk.rotate("Neck", axis, ang * neck_share)
        cur = sk.pose("Head").to_3x3() @ sk.rest["Head"].to_3x3().inverted()
        q = cur.inverted().to_quaternion()
        axis, ang = q.to_axis_angle()
        sk.rotate("Head", axis, ang)
        sk.rotate("Head", X, pitch)  # + = looking down
        sk.rotate("Head", Z, yaw)
        sk.rotate("Head", Y, roll)

    # --- legs ---------------------------------------------------------------------------------------------------
    def leg(self, side, sg, ankle, pitch=0.0, yaw=0.0, toe=0.0, knee_out=0.12):
        """Ankle onto `ankle` (world), knee toward the front (a little out), foot pitched (+ = toes down), toes bent."""
        sk = self.sk
        hip = sk.head(side + "UpLeg")
        mid = (hip + ankle) * 0.5
        pole = mid + FWD * 0.6 + X * (sg * knee_out)
        sk.two_bone(side + "UpLeg", side + "Leg", side + "Foot", ankle, pole)
        rot = Matrix.Rotation(yaw, 3, Z) @ Matrix.Rotation(pitch, 3, X)
        sk.orient(side + "Foot", rot)
        sk.rotate(side + "ToeBase", X, -toe)

    def foot_on_ground(self, side, sg, along, lift=0.0, pitch=0.0, width=0.0, toe=0.0, yaw=0.0):
        """
        Places a foot by where it is along the walking line (m, + forward of the hip), its lift (m, of the sole) and
        its pitch; the pitch rolls it about the heel (toes up) or the ball (heel up), so a planted sole stays on the
        ground.
        """
        base = Vector((sg * (self.stance_x + width), 0, self.ankle_h))
        base.y = self.ankle0[side].y - along
        base.z += lift
        if pitch > 0:  # heel up: roll about the ball of the foot
            base.z += self.foot_len * math.sin(pitch) * 0.95
            base.y -= self.foot_len * (1 - math.cos(pitch))  # the ankle rolls forward over the ball
        elif pitch < 0:  # toes up: roll about the heel (behind and below the ankle)
            base.z += 0.04 * math.sin(-pitch)
        self.leg(side, sg, base, pitch=pitch, toe=toe, yaw=yaw)

    # --- arms ---------------------------------------------------------------------------------------------------
    def arm(self, side, sg, swing=0.0, out=0.14, elbow=0.25, twist=0.0, raise_=0.0, reach=0.0):
        """
        Hanging arm: from the A pose down to the side (out = its angle away from the body), swung forward (+) or back
        about the shoulder, raised sideways (raise_), elbow bent forward (rad), forearm twist.
        """
        sk = self.sk
        sh = sk.head(side + "Arm")
        down = Vector((sg * math.sin(out), 0.0, -math.cos(out)))
        sk.aim(side + "Arm", side + "ForeArm", sh + down)
        # Straighten the rest pose's bent elbow onto the upper arm's line; the bend below starts from straight.
        el = sk.head(side + "ForeArm")
        sk.aim(side + "ForeArm", side + "Hand", el + (el - sh))
        # Elbow flexion while the arm hangs (the hinge is the lateral axis: the forearm comes forward), then the
        # forearm's twist; then the whole arm is raised sideways and swung, carrying the bent elbow with it.
        sk.rotate(side + "ForeArm", X, -elbow)
        if twist:
            sk.rotate(side + "ForeArm", (sk.head(side + "Hand") - sk.head(side + "ForeArm")).normalized(), twist * sg)
        sk.rotate(side + "Arm", FWD, sg * raise_)
        sk.rotate(side + "Arm", X, -swing)
        if reach:
            sk.rotate(side + "Hand", X, -reach)

    def shoulders(self, lift=0.0, fwd=0.0):
        """Shrugs (lift, rad) and rolls the shoulders forward (fwd)."""
        for side, sg in SIDES:
            self.sk.rotate(side + "Shoulder", FWD, sg * lift)
            self.sk.rotate(side + "Shoulder", Z, -sg * fwd)

    def fingers(self, curl=0.35, thumb=0.2):
        """Relaxed hand: every finger joint curled a little (about the hand's across axis)."""
        sk = self.sk
        for side, sg in SIDES:
            hand = sk.pose(side + "Hand")
            h = hand.translation
            mid = sk.head(side + "HandMiddle1")
            idx = sk.head(side + "HandIndex1")
            pk = sk.head(side + "HandPinky1")
            d = (mid - h).normalized()
            across = (idx - pk)
            across = (across - d * across.dot(d)).normalized()
            palm = d.cross(across).normalized()
            # Palm faces the body side (toward -sg X) when hanging: pick the sign that curls toward it.
            if palm.x * sg > 0:
                palm = -palm
            axis = d.cross(palm).normalized()
            for f in ("Index", "Middle", "Ring", "Pinky"):
                for i in (1, 2, 3):
                    n = f"{side}Hand{f}{i}"
                    if n in sk.bones:
                        sk.rotate(n, axis, curl * (1.0, 1.2, 0.8)[i - 1] * (1 + 0.15 * ("Pinky", "Ring", "Middle", "Index").index(f) / 3))
            for i in (1, 2, 3):
                n = f"{side}HandThumb{i}"
                if n in sk.bones:
                    sk.rotate(n, d, thumb * (-sg) * 0.6)

    # --- keys ---------------------------------------------------------------------------------------------------
    def key(self, frame):
        rig = self.sk.rig
        for pb in rig.pose.bones:
            n = pb.name.replace("mixamorig:", "")
            pb.rotation_mode = "QUATERNION"
            b = self.sk.basis[n]
            pb.matrix_basis = b
            pb.keyframe_insert("rotation_quaternion", frame=frame)
            pb.keyframe_insert("location", frame=frame)


# ---------------------------------------------------------------------------------------------------------------
# Clips. Each is pose(b, t) with t in seconds; phase = t / duration for loops.

def idle_pose(b, t, crouch=0.0):
    T = CLIPS["idle"][0]
    ph = t / T
    breath = math.sin(2 * math.pi * ph * 3)  # three breaths per loop
    shift = math.sin(2 * math.pi * ph)  # one weight shift left and right per loop
    b.start()
    sink = 0.02 + 0.33 * crouch
    b.pelvis(Vector((0.018 * shift, 0.0 + 0.06 * crouch, -sink + 0.004 * breath)), yaw=0.03 * shift, roll=0.025 * shift, pitch=0.05 + 0.35 * crouch)
    b.trunk(pitch=0.03 + 0.22 * crouch + 0.012 * breath, roll=-0.02 * shift)
    b.shoulders(lift=0.02 + 0.015 * breath)
    b.head_level(pitch=0.02 - 0.1 * crouch, yaw=0.08 * math.sin(2 * math.pi * ph * 2 + 1.0))
    for side, sg in SIDES:
        load = 0.5 + 0.5 * shift * sg
        b.foot_on_ground(side, sg, along=0.03 * sg + 0.05 * crouch * sg, width=0.035 + 0.06 * crouch, yaw=sg * 0.12)
        b.arm(side, sg, swing=0.05 + 0.22 * crouch, out=0.12 + 0.14 * crouch + 0.02 * breath, elbow=0.22 + 0.4 * crouch + 0.05 * load)
    b.fingers(0.35, 0.25)


def crouch_idle_pose(b, t):
    T = CLIPS["crouch_idle"][0]
    idle_pose(b, t * CLIPS["idle"][0] / T, crouch=1.0)


def gait(b, ph, *, speed, T, duty, stride_scale=1.0, bob=0.03, bob_run=False, lean=0.05, sink=0.03, lift=0.1,
         arm_swing=0.35, elbow=0.3, elbow_swing=0.12, pelvis_yaw=0.07, pelvis_roll=0.04, sway=0.022, knee_high=0.0,
         heel_kick=0.0, crouch=0.0):
    """
    One gait cycle at phase ph (0 = left heel strike): the stance foot slides back at `speed`, the swing foot is
    carried forward on an eased arc; the pelvis bobs, sways over the stance foot, turns with the swinging leg; the
    chest counter-turns; arms swing against the legs.
    """
    b.start()
    L = speed * T * duty * stride_scale  # ground covered while a foot is down
    two_pi = 2 * math.pi
    if bob_run:
        # Running: lowest at mid-stance (compression), highest in the flight phase.
        z = -sink - bob * math.cos(two_pi * 2 * (ph - duty / 2))
    else:
        # Walking: lowest at the double support after each heel strike, highest over the stance leg.
        z = -sink - bob * math.cos(two_pi * 2 * (ph - 0.25)) * -1 - bob
    x = sway * math.sin(two_pi * ph)
    yaw = -pelvis_yaw * math.cos(two_pi * ph)  # left hip forward at left heel strike
    roll = -pelvis_roll * math.sin(two_pi * ph)  # the swing side drops
    b.pelvis(Vector((x, 0.0, z)), yaw=yaw, roll=roll, pitch=lean * 0.6 + crouch * 0.3)
    b.trunk(pitch=lean + crouch * 0.2, yaw=-yaw * 1.6, roll=-roll * 0.8)
    b.shoulders(lift=0.02, fwd=0.03 * speed / 5)
    b.head_level(pitch=0.02 - 0.08 * crouch)
    for side, sg in SIDES:
        p = (ph + (0.0 if side == "Left" else 0.5)) % 1.0
        if p < duty:
            # Stance: slides back; heel strike (toes up) eases flat, heel rises before toe-off.
            u = p / duty
            along = L / 2 - L * u
            pitch = -0.28 * (1 - ease(u / 0.22)) if not bob_run else -0.08 * (1 - ease(u / 0.15))
            pitch += 0.55 * ease((u - 0.62) / 0.38) if not bob_run else 0.6 * ease((u - 0.55) / 0.45)
            toe = 0.45 * ease((u - 0.65) / 0.35)
            b.foot_on_ground(side, sg, along, lift=0.0, pitch=pitch, toe=toe, width=0.01)
        else:
            # Swing: from behind to ahead on an eased path; lifted, the knee brought up, the heel kicked back (run).
            u = (p - duty) / (1 - duty)
            e = ease(u)
            along = -L / 2 + L * e - heel_kick * math.sin(math.pi * min(1.0, u * 1.6)) * (1 - u)
            h = lift * math.sin(math.pi * u) ** 0.8 + heel_kick * 0.9 * math.sin(math.pi * min(1.0, u * 1.4)) * (1 - u * 0.7)
            h += knee_high * math.sin(math.pi * u) ** 2 * 0.5
            pitch = lerp(0.6 if bob_run else 0.45, -0.2, ease(u * 1.3))
            b.foot_on_ground(side, sg, along, lift=h, pitch=pitch, toe=0.0, width=0.0)
        # Arm against the same-side leg: forward while that leg is back.
        a = -arm_swing * math.cos(two_pi * p)
        b.arm(side, sg, swing=a + 0.08, out=0.1 + 0.03 * speed / 5, elbow=elbow + elbow_swing * max(0.0, a) / max(arm_swing, 1e-3), twist=0.25)
    b.fingers(0.5 if bob_run else 0.35, 0.3)


def walk_pose(b, t):
    T = CLIPS["walk"][0]
    gait(b, (t / T) % 1.0, speed=CLIPS["walk"][2], T=T, duty=0.62, bob=0.018, lean=0.05, sink=0.035, lift=0.07,
         arm_swing=0.32, elbow=0.28, elbow_swing=0.25, pelvis_yaw=0.08, pelvis_roll=0.035, sway=0.02)


def run_pose(b, t):
    T = CLIPS["run"][0]
    gait(b, (t / T) % 1.0, speed=CLIPS["run"][2], T=T, duty=0.36, bob=0.035, bob_run=True, lean=0.16, sink=0.06,
         lift=0.1, arm_swing=0.45, elbow=1.35, elbow_swing=0.2, pelvis_yaw=0.12, pelvis_roll=0.05, sway=0.012,
         knee_high=0.25, heel_kick=0.26)


def crouch_walk_pose(b, t):
    T = CLIPS["crouch_walk"][0]
    gait(b, (t / T) % 1.0, speed=CLIPS["crouch_walk"][2], T=T, duty=0.66, bob=0.012, lean=0.28, sink=0.32, lift=0.08,
         arm_swing=0.2, elbow=0.55, elbow_swing=0.15, pelvis_yaw=0.06, pelvis_roll=0.02, sway=0.018, crouch=1.0)


def run_stop_pose(b, t):
    """
    From a run to a stand: the body brakes over ~0.45 s. The front foot plants ahead with the heel, the trunk leans back
    against the momentum, the trailing foot comes through and plants beside it; then the weight settles forward over the
    feet with a small overshoot, the arms swing forward and down. Planted feet stay put while the body travels on
    (the in-place clip slides them back by the body's travel, v(t) in the game side's table).
    """
    T = CLIPS["run_stop"][0]
    v0 = CLIPS["run"][2]
    brake = 0.45

    def travel(tt):
        # Distance the body covers while braking (v falls from v0 to 0 in `brake` s, eased).
        tt = min(tt, brake)
        return v0 * (tt - tt * tt / brake + tt ** 3 / (3 * brake * brake))
    b.start()
    d = travel(t)
    D = travel(brake)
    s = spring(max(0.0, t - 0.2), 2.4, 0.4)  # the settle after the brake
    lean_back = 0.42 * math.sin(math.pi * min(1.0, t / 0.55))
    # Pelvis: drops into the brake, rises with the settle.
    z = -0.09 * math.sin(math.pi * min(1.0, t / 0.55)) - 0.02 * (1 - s)
    b.pelvis(Vector((0.0, 0.0, z)), pitch=lerp(0.12, 0.05, s) - lean_back * 0.4)
    b.trunk(pitch=lerp(0.16, 0.03, s) - lean_back + 0.06 * (s - 1) * -1)
    b.shoulders(lift=0.03)
    b.head_level(pitch=0.05 * lean_back)
    # Right foot: planted ahead at t=0 (it was the leading foot), at world position D*0.55 ahead of the start.
    right_world = 0.55 * D + 0.25
    left_touch = 0.3  # the left comes through and lands beside at 0.3 s
    left_world = D + 0.02
    for side, sg in SIDES:
        if side == "Right":
            along = right_world - d
            pitch = -0.3 * (1 - ease(t / 0.18))
            b.foot_on_ground(side, sg, along, pitch=pitch, width=0.04)
        else:
            if t < left_touch:
                u = t / left_touch
                start = -0.45  # behind the body at the start
                along = lerp(start, left_world - travel(left_touch), ease(u))
                lift = 0.16 * math.sin(math.pi * u)
                b.foot_on_ground(side, sg, along, lift=lift, pitch=lerp(0.5, -0.15, ease(u)), width=0.04)
            else:
                along = left_world - d
                b.foot_on_ground(side, sg, along, pitch=-0.15 * (1 - ease((t - left_touch) / 0.12)), width=0.04)
    for side, sg in SIDES:
        # Arms: from the run's bent swing forward (catching the balance), then down to hang.
        k = ease(t / 0.6)
        b.arm(side, sg, swing=lerp(0.4 if side == "Left" else -0.3, 0.06, k) + 0.25 * lean_back, out=lerp(0.14, 0.12, k),
              elbow=lerp(1.3, 0.25, ease(t / 0.75)), twist=0.25)
    b.fingers(0.4, 0.25)


def jump_start_pose(b, t):
    """Anticipation squat (0 → 0.16 s) then the drive up onto the toes (take-off at the end)."""
    T = CLIPS["jump_start"][0]
    u = t / T
    squat = math.sin(math.pi * min(1.0, u / 0.75)) if u < 0.75 else 0.0
    drive = ease((u - 0.55) / 0.45)
    b.start()
    b.pelvis(Vector((0, 0.03 * squat, -0.22 * squat + 0.06 * drive)), pitch=0.35 * squat)
    b.trunk(pitch=0.3 * squat - 0.05 * drive)
    b.head_level(pitch=-0.1 * squat)
    for side, sg in SIDES:
        b.foot_on_ground(side, sg, 0.0, pitch=0.7 * drive, toe=0.5 * drive, width=0.03)
        # Arms swing back in the squat, then forward and up with the drive.
        b.arm(side, sg, swing=lerp(-0.7 * squat, 1.0, drive), out=0.18, elbow=0.3 + 0.25 * squat + 0.6 * drive)
    b.fingers(0.3, 0.2)


def air_pose(b, t, falling):
    """
    In the air. Rising: carried up by the drive, the knees drawn up (one a little higher), the arms forward at chest
    height, elbows bent, the chest a little forward. Falling: the legs lowering to meet the ground (knees soft, one
    foot ahead), the arms out to the sides and a little forward for balance, the gaze down toward the landing.
    """
    T = CLIPS["jump_rise"][0]
    w = math.sin(2 * math.pi * t / T)
    b.start()
    if falling:
        b.pelvis(Vector((0, 0, 0.0)), pitch=0.06)
        b.trunk(pitch=0.08 + 0.01 * w)
        b.head_level(pitch=0.22)
        for side, sg in SIDES:
            ahead = 0.08 if side == "Left" else -0.02
            ankle = Vector((sg * 0.14, b.ankle0[side].y - ahead, b.ankle_h + 0.1))
            b.leg(side, sg, ankle, pitch=0.3, knee_out=0.12)
            b.arm(side, sg, swing=0.35 + 0.04 * w, raise_=0.55, out=0.12, elbow=0.55)
    else:
        b.pelvis(Vector((0, 0, 0.0)), pitch=0.14)
        b.trunk(pitch=0.12 + 0.01 * w)
        b.head_level(pitch=0.05)
        for side, sg in SIDES:
            lift = 0.3 if side == "Left" else 0.2
            ankle = Vector((sg * 0.13, b.ankle0[side].y + 0.14, b.ankle_h + lift))
            b.leg(side, sg, ankle, pitch=0.5, knee_out=0.08)
            b.arm(side, sg, swing=1.0 + 0.05 * w, raise_=0.12, out=0.1, elbow=1.05)
    b.fingers(0.3, 0.2)


def jump_land_pose(b, t):
    """Impact: the knees give (fast), the trunk folds over them, the arms swing forward and down; then it rises back
    to the stand with a small overshoot."""
    T = CLIPS["jump_land"][0]
    give = math.exp(-((t - 0.12) / 0.11) ** 2) if t < 0.12 else 1 - spring(t - 0.12, 1.9, 0.45)
    give = max(0.0, give)
    b.start()
    b.pelvis(Vector((0, 0.03 * give, -0.26 * give - 0.02)), pitch=0.4 * give + 0.05)
    b.trunk(pitch=0.3 * give + 0.03)
    b.head_level(pitch=-0.12 * give)
    for side, sg in SIDES:
        b.foot_on_ground(side, sg, 0.03 * sg, width=0.05, yaw=sg * 0.12)
        b.arm(side, sg, swing=0.55 * give + 0.05, out=0.18 + 0.1 * give, elbow=0.3 + 0.5 * give)
    b.fingers(0.35, 0.25)


def glide_pose(b, t):
    """Hezarfen's glide, upright frame (the game pitches the whole body into the flight line): arms spread out to the
    sides and a little back holding the wing spars, legs together and trailing, the head up looking ahead; a slow
    breathing and balancing motion."""
    T = CLIPS["glide"][0]
    ph = t / T
    w = math.sin(2 * math.pi * ph)
    b.start()
    b.pelvis(Vector((0, 0, 0)), roll=0.03 * w)
    b.trunk(pitch=-0.12, roll=-0.02 * w)
    b.head_level(pitch=-0.5)
    for side, sg in SIDES:
        b.arm(side, sg, raise_=1.35 + 0.04 * w * sg, swing=-0.12, out=0.05, elbow=0.12, twist=-0.4)
        ankle = Vector((sg * 0.09, b.ankle0[side].y + 0.12, b.ankle_h + 0.02))
        b.leg(side, sg, ankle, pitch=0.9, knee_out=0.05)
    b.fingers(0.9, 0.6)


def idle_look_pose(b, t):
    """Standing, looks over the left shoulder (the chest turning with the head), holds, then to the right, and back:
    each turn eased, the weight shifting onto the foot it turns toward."""
    T = CLIPS["idle_look"][0]
    # Keys (s → look yaw, + = left): 0 → 0, 0.9 → 0.75, 1.9 → 0.75, 2.8 → -0.6, 3.8 → -0.6, 4.7 → 0.
    keys = [(0.0, 0.0), (0.9, 0.75), (1.9, 0.72), (2.8, -0.6), (3.8, -0.62), (4.7, 0.0), (T, 0.0)]
    look = 0.0
    for (t0, v0), (t1, v1) in zip(keys, keys[1:]):
        if t0 <= t <= t1:
            look = lerp(v0, v1, ease((t - t0) / max(t1 - t0, 1e-6)))
            break
    breath = math.sin(2 * math.pi * t / 1.6)
    b.start()
    b.pelvis(Vector((0.015 * look, 0.0, -0.02 + 0.004 * breath)), yaw=0.12 * look, roll=0.02 * look, pitch=0.05)
    b.trunk(pitch=0.03 + 0.01 * breath, yaw=0.35 * look)
    b.shoulders(lift=0.02 + 0.01 * breath)
    b.head_level(pitch=0.02, yaw=look * 0.9, roll=-0.05 * look)
    for side, sg in SIDES:
        b.foot_on_ground(side, sg, along=0.03 * sg, width=0.035, yaw=sg * 0.12)
        b.arm(side, sg, swing=0.05 + 0.04 * look * sg, out=0.12, elbow=0.22)
    b.fingers(0.35, 0.25)


def idle_shoulders_pose(b, t):
    """Standing, rolls the shoulders back twice, tilts the head to each side (a stretch), flexes the hands."""
    T = CLIPS["idle_shoulders"][0]
    roll = math.sin(2 * math.pi * min(1.0, t / 1.6) * 2) * ease(t / 0.3) * (1 - ease((t - 1.3) / 0.3))
    tilt = math.sin(2 * math.pi * max(0.0, (t - 1.6)) / 2.0) * (1 - ease((t - 3.4) / 0.5)) if t > 1.6 else 0.0
    flex = math.sin(math.pi * min(1.0, max(0.0, (t - 2.4) / 1.2)))
    b.start()
    b.pelvis(Vector((0.0, 0.0, -0.02)), pitch=0.05)
    b.trunk(pitch=0.02 - 0.04 * max(0.0, roll))
    b.shoulders(lift=0.05 + 0.06 * max(0.0, roll), fwd=-0.12 * roll)
    b.head_level(pitch=0.03 - 0.06 * max(0.0, roll), roll=0.35 * tilt, yaw=0.08 * tilt)
    for side, sg in SIDES:
        b.foot_on_ground(side, sg, along=0.03 * sg, width=0.035, yaw=sg * 0.12)
        b.arm(side, sg, swing=0.05, out=0.13 + 0.03 * max(0.0, roll), elbow=0.22 + 0.2 * flex)
    b.fingers(0.35 + 0.5 * flex, 0.25 + 0.3 * flex)


POSES = {
    "idle": idle_pose,
    "walk": walk_pose,
    "run": run_pose,
    "crouch_idle": crouch_idle_pose,
    "crouch_walk": crouch_walk_pose,
    "run_stop": run_stop_pose,
    "jump_start": jump_start_pose,
    "jump_rise": lambda b, t: air_pose(b, t, False),
    "jump_fall": lambda b, t: air_pose(b, t, True),
    "jump_land": jump_land_pose,
    "glide": glide_pose,
    "idle_look": idle_look_pose,
    "idle_shoulders": idle_shoulders_pose,
}


def author(rig, only=None):
    """Bakes every clip into an action on the rig (fake user, so the exporter keeps them all)."""
    bpy.context.scene.render.fps = FPS
    sk = Skel(rig)
    b = Body(sk)
    if rig.animation_data is None:
        rig.animation_data_create()
    made = []
    for name, (dur, loop, _speed) in CLIPS.items():
        if only and name not in only:
            continue
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        rig.animation_data.action = act
        frames = max(2, int(round(dur * FPS)))
        last = frames if loop else frames  # a loop keys its first pose again at the end
        for f in range(0, last + 1):
            t = min(f / FPS, dur)
            if loop and f == last:
                t = 0.0
            POSES[name](b, t)
            b.key(f + 1)
        made.append(name)
    rig.animation_data.action = None
    for pb in rig.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    return made
