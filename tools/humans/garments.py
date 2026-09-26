"""
Garment helpers for the rider pipeline: cut a region out of the (posed, rest-applied) body by bone weights, grow it
into a garment shell, settle it with a cloth simulation against the body, skin it from the body and hand it to the rig.
All in Blender units (m), Blender axes: +X the rider's left, -Y forward, +Z up.
"""
import bmesh
import bpy
from mathutils import Vector


def bone_weights(obj):
    """Per-vertex dict {bone name without 'mixamorig:': weight}."""
    names = {g.index: g.name.replace("mixamorig:", "") for g in obj.vertex_groups if g.name.startswith("mixamorig:")}
    out = []
    for v in obj.data.vertices:
        out.append({names[g.group]: g.weight for g in v.groups if g.weight > 1e-4 and g.group in names})
    return out


def region(body, name, keep, rig=None):
    """
    New mesh object with the body faces whose vertices all pass keep(co, weights, index); keeps vertex groups.
    co is the world position.
    """
    bpy.ops.object.select_all(action="DESELECT")
    dup = body.copy()
    dup.data = body.data.copy()
    dup.name = name
    dup.data.name = name
    bpy.context.scene.collection.objects.link(dup)
    for m in list(dup.modifiers):
        dup.modifiers.remove(m)
    if dup.data.shape_keys:
        dup.shape_key_clear()
    dup.data.materials.clear()
    w = bone_weights(dup)
    mw = dup.matrix_world
    ok = [keep(mw @ v.co, w[i], i) for i, v in enumerate(dup.data.vertices)]
    bm = bmesh.new()
    bm.from_mesh(dup.data)
    bm.verts.ensure_lookup_table()
    doomed = [f for f in bm.faces if not all(ok[v.index] for v in f.verts)]
    bmesh.ops.delete(bm, geom=doomed, context="FACES")
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.to_mesh(dup.data)
    bm.free()
    dup.data.update()
    return dup


def apply_all(obj):
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    for m in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


BODY = {"obj": None}


def trim(obj, point, normal):
    """Cuts the mesh with a plane and removes what lies on the normal's side (a clean, straight hem)."""
    import bmesh
    mw = obj.matrix_world
    inv = mw.inverted()
    p = inv @ Vector(point)
    n = (inv.to_3x3() @ Vector(normal)).normalized()
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=p, plane_no=n, clear_outer=True)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def grow(obj, offset, thickness, smooth=6, subdiv=1, noise=0.0, noise_scale=0.08, loose=0, remesh=0.0, folds=0.0, trims=()):
    """
    Pushes the surface out along its normals and relaxes it (loose = extra smoothing so the garment bridges the body's
    hollows instead of hugging them), gives it thickness, optionally rebuilds a clean watertight topology (voxel
    remesh, m), then adds cloth folds: `folds` hangs long vertical ripples (gravity), `noise` general bumps.
    """
    d = obj.modifiers.new("grow", "DISPLACE")
    d.direction = "NORMAL"
    d.mid_level = 0.0
    d.strength = offset
    if smooth or loose:
        # Relax hard: the garment bridges hollows (armpits, the small of the back, between the fingers)...
        s = obj.modifiers.new("smooth", "SMOOTH")
        s.factor = 0.9
        s.iterations = smooth + loose
    if BODY["obj"] is not None:
        # ...but never sinks into the body: anything inside is pushed back out to a minimum gap.
        sw = obj.modifiers.new("keep_out", "SHRINKWRAP")
        sw.target = BODY["obj"]
        sw.wrap_method = "NEAREST_SURFACEPOINT"
        sw.wrap_mode = "OUTSIDE"
        sw.offset = min(offset, 0.006)
    if trims:
        apply_all(obj)
        for pt, nr in trims:
            trim(obj, pt, nr)
    if thickness > 0:
        so = obj.modifiers.new("thick", "SOLIDIFY")
        so.thickness = thickness
        so.offset = -1.0
        so.use_rim = True
    apply_all(obj)
    if remesh > 0:
        rm = obj.modifiers.new("remesh", "REMESH")
        rm.mode = "VOXEL"
        rm.voxel_size = remesh
        rm.adaptivity = 0.0
        cs = obj.modifiers.new("relax", "CORRECTIVE_SMOOTH")
        cs.iterations = 4
        cs.use_only_smooth = True
        apply_all(obj)
    if folds > 0:
        tex = bpy.data.textures.new(obj.name + "_drape", "WOOD")
        tex.wood_type = "BANDNOISE"
        tex.noise_basis_2 = "SIN"
        tex.noise_scale = 0.35
        tex.turbulence = 6.0
        f = obj.modifiers.new("drape", "DISPLACE")
        f.texture = tex
        f.texture_coords = "GLOBAL"
        f.direction = "NORMAL"
        f.strength = folds
        f.mid_level = 0.5
    if noise > 0:
        tex = bpy.data.textures.new(obj.name + "_folds", "CLOUDS")
        tex.noise_scale = noise_scale
        tex.noise_depth = 2
        n = obj.modifiers.new("folds", "DISPLACE")
        n.texture = tex
        n.texture_coords = "GLOBAL"
        n.direction = "NORMAL"
        n.strength = noise
        n.mid_level = 0.5
    if subdiv:
        sd = obj.modifiers.new("subd", "SUBSURF")
        sd.levels = subdiv
        sd.render_levels = subdiv
    apply_all(obj)
    smooth_shade(obj)


def cloth_settle(obj, colliders, pin_group=None, frames=24, mass=0.25, stiffness=8.0, gravity=True):
    """Drops the garment under gravity for a few frames against the colliders (folds, drape), then keeps the result."""
    for c in colliders:
        if not any(m.type == "COLLISION" for m in c.modifiers):
            col = c.modifiers.new("collision", "COLLISION")
            col.settings.thickness_outer = 0.006
            col.settings.cloth_friction = 8.0
    cl = obj.modifiers.new("cloth", "CLOTH")
    st = cl.settings
    st.quality = 8
    st.mass = mass
    st.tension_stiffness = stiffness
    st.compression_stiffness = stiffness
    st.bending_stiffness = 0.6
    st.shear_stiffness = stiffness * 0.5
    if pin_group:
        st.vertex_group_mass = pin_group
    if not gravity:
        st.effector_weights.gravity = 0.0
    cl.collision_settings.use_self_collision = False
    cl.collision_settings.distance_min = 0.004
    scene = bpy.context.scene
    scene.frame_start = 1
    scene.frame_end = frames
    cl.point_cache.frame_start = 1
    cl.point_cache.frame_end = frames
    for f in range(1, frames + 1):
        scene.frame_set(f)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=cl.name)
    scene.frame_set(1)


def pin_group(obj, name, weight_of):
    """Vertex group for cloth pinning: weight_of(world co) in 0..1 (1 = pinned)."""
    g = obj.vertex_groups.get(name) or obj.vertex_groups.new(name=name)
    mw = obj.matrix_world
    for v in obj.data.vertices:
        g.add([v.index], max(0.0, min(1.0, weight_of(mw @ v.co))), "REPLACE")
    return name


def skin(obj, body, rig):
    """Skin weights from the nearest body surface, an armature modifier, parented to the rig (keeps the transform)."""
    for g in list(obj.vertex_groups):
        obj.vertex_groups.remove(g)
    for g in body.vertex_groups:
        if g.name.startswith("mixamorig:"):
            obj.vertex_groups.new(name=g.name)
    dt = obj.modifiers.new("weights", "DATA_TRANSFER")
    dt.object = body
    dt.use_vert_data = True
    dt.data_types_verts = {"VGROUP_WEIGHTS"}
    dt.vert_mapping = "POLYINTERP_NEAREST"
    dt.layers_vgroup_select_src = "ALL"  # only bone groups exist on the target, matched by name
    dt.layers_vgroup_select_dst = "NAME"
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=dt.name)
    arm = obj.modifiers.new("Armature", "ARMATURE")
    arm.object = rig
    mw = obj.matrix_world.copy()
    obj.parent = rig
    obj.matrix_world = mw


def material(obj, name, color=(0.5, 0.5, 0.5), rough=0.8, metal=0.0):
    """One named material (the game swaps it for its own shader by name, rider_<id>)."""
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*color, 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    m.diffuse_color = (*color, 1.0)
    m.metallic = metal
    m.roughness = rough
    obj.data.materials.clear()
    obj.data.materials.append(m)
    return m


def smooth_shade(obj):
    for p in obj.data.polygons:
        p.use_smooth = True


def add_primitive(kind, name, loc, scale=(1, 1, 1), rot=(0, 0, 0), **kw):
    """Primitive object (uv sphere, cylinder, torus, cube) applied into mesh space."""
    ops = {
        "sphere": lambda: bpy.ops.mesh.primitive_uv_sphere_add(segments=kw.get("segments", 32), ring_count=kw.get("rings", 16)),
        "cylinder": lambda: bpy.ops.mesh.primitive_cylinder_add(vertices=kw.get("vertices", 32)),
        "torus": lambda: bpy.ops.mesh.primitive_torus_add(major_radius=kw.get("major", 1.0), minor_radius=kw.get("minor", 0.1), major_segments=kw.get("vertices", 48), minor_segments=12),
        "cube": lambda: bpy.ops.mesh.primitive_cube_add(),
        "cone": lambda: bpy.ops.mesh.primitive_cone_add(vertices=kw.get("vertices", 32), radius1=kw.get("r1", 1.0), radius2=kw.get("r2", 0.0), depth=kw.get("depth", 2.0)),
    }
    ops[kind]()
    o = bpy.context.active_object
    o.name = name
    o.location = loc
    o.scale = scale
    o.rotation_euler = rot
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    smooth_shade(o)
    return o


def vec(*a):
    return Vector(a)
