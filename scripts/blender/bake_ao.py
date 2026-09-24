"""
Bakes ambient occlusion per tile into its UV1 lightmap atlas (TEXCOORD_1 of the tile glb), with Cycles on the Metal
GPU. Occluders: the baked tiles, every tile within 60 m of them (their LOD1 glb) and all prop instances of those tiles.

    node scripts/blender-run.mjs --timeout 3600 scripts/blender/bake_ao.py -- [options]
      --area <id>          default kadikoy
      --tiles <strip|ids>  "strip" (default: index.strip.tiles) or comma-separated tile ids
      --lod <0|1>          which LOD glb's atlas to bake (default 0)
      --samples <n>        AO samples per texel (default 256)
      --distance <m>       AO ray length (default 1.0 m: contact darkening 0.2-0.5 m wide, soffits, reveals)
      --max-size <px>      cap the atlas size (default: the manifest's lightmap.size)
      --out <dir>          default .shots/s1/renders/ao
      --preview <camera>   also render that camera with the baked AO as the only shading (evidence image)

Output per tile: <out>/<tile>.lod<k>.ao.png (8-bit greyscale, linear: 1 = open, 0 = fully occluded; atlas padding
dilated by `lightmap.padding` texels) and <out>/ao.json (tile, lod, glb hash, size, texels/m, samples, seconds).
A runtime uses it as an occlusion map on TEXCOORD_1 (three.js: aoMap with channel 1; Godot: ao_texture on UV2).
"""

import argparse
import json
import os
import sys
import time

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import import_area  # noqa: E402

ROOT = import_area.ROOT
UV1 = 'UVMap.001'
NEIGHBOUR_M = 60.0


def log(*args):
    print('[evren:ao]', *args, flush=True)


def square_gap(a, b):
    dx = max(a['minX'] - b['maxX'], 0.0, b['minX'] - a['maxX'])
    dz = max(a['minZ'] - b['maxZ'], 0.0, b['minZ'] - a['maxZ'])
    return (dx * dx + dz * dz) ** 0.5


def picks_for(area, bake_ids, lod_level):
    tiles = {t['id']: t for t in area.index['tiles']}
    out = []
    for t in area.index['tiles']:
        lods = t.get('lods') or [{'level': 0, 'glb': t['glb']}]
        if t['id'] in bake_ids:
            level = lod_level
        elif any(square_gap(t['bounds'], tiles[b]['bounds']) <= NEIGHBOUR_M for b in bake_ids if b in tiles):
            level = 1
        else:
            continue
        out.append((t, next((l for l in lods if l['level'] == level), lods[-1])))
    return out


def setup_gpu(samples):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    gpu = False
    for d in prefs.devices:
        d.use = d.type == 'METAL'
        gpu = gpu or d.use
    scene.cycles.device = 'GPU' if gpu else 'CPU'
    scene.cycles.samples = samples
    scene.cycles.use_adaptive_sampling = False
    scene.cycles.use_denoising = False
    return scene.cycles.device


def bake_tile(obj, size, padding, out_path):
    img = bpy.data.images.new(os.path.basename(out_path), size, size, alpha=False, float_buffer=False)
    img.colorspace_settings.name = 'Non-Color'
    nodes = []
    for slot in obj.material_slots:
        m = slot.material
        if m is None or not m.use_nodes:
            continue
        n = m.node_tree.nodes.get('evren_bake') or m.node_tree.nodes.new('ShaderNodeTexImage')
        n.name = 'evren_bake'
        n.image = img
        m.node_tree.nodes.active = n
        nodes.append(n)
    obj.data.uv_layers.active = obj.data.uv_layers[UV1]
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    t0 = time.time()
    bpy.ops.object.bake(type='AO', target='IMAGE_TEXTURES', uv_layer=UV1, use_clear=True, margin=padding, margin_type='EXTEND')
    secs = time.time() - t0
    img.filepath_raw = out_path
    img.file_format = 'PNG'
    img.save()
    obj.data.uv_layers.active = obj.data.uv_layers[0]
    return img, secs


def preview(area, cam_rec, baked, out_path):
    """Renders the camera with every baked tile shaded by its AO atlas only (emission, UV1); other surfaces grey."""
    scene = bpy.context.scene
    for o in bpy.data.collections['tiles'].objects:
        img = baked.get(o.get('tile'))
        mat = bpy.data.materials.new(f"ao_preview_{o.get('tile')}")
        nt = mat.node_tree
        for n in list(nt.nodes):
            nt.nodes.remove(n)
        out = nt.nodes.new('ShaderNodeOutputMaterial')
        em = nt.nodes.new('ShaderNodeEmission')
        nt.links.new(em.outputs[0], out.inputs['Surface'])
        if img is not None:
            uv = nt.nodes.new('ShaderNodeUVMap')
            uv.uv_map = UV1
            tex = nt.nodes.new('ShaderNodeTexImage')
            tex.image = img
            nt.links.new(uv.outputs[0], tex.inputs[0])
            nt.links.new(tex.outputs['Color'], em.inputs['Color'])
        else:
            em.inputs['Color'].default_value = (0.5, 0.5, 0.5, 1)
        for slot in o.material_slots:
            slot.material = mat
    world = bpy.data.worlds.new('ao_preview')
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.02, 0.02, 0.025, 1)
    scene.world = world
    for c in ('instances', 'lights', 'standins'):
        coll = bpy.data.collections.get(c)
        if coll:
            coll.hide_render = True
    import_area.setup_camera(cam_rec)
    scene.cycles.samples = 4
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.view_settings.exposure = 0.0
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = out_path
    bpy.ops.render.render(write_still=True)


def main():
    p = argparse.ArgumentParser(prog='bake_ao.py')
    p.add_argument('--area', default='kadikoy')
    p.add_argument('--tiles', default='strip')
    p.add_argument('--lod', type=int, default=0)
    p.add_argument('--samples', type=int, default=256)
    p.add_argument('--distance', type=float, default=1.0)
    p.add_argument('--max-size', type=int, default=0)
    p.add_argument('--out', default=os.path.join(ROOT, '.shots', 's1', 'renders', 'ao'))
    p.add_argument('--preview', default=None)
    a = p.parse_args(import_area.script_args())

    area = import_area.Area(a.area)
    bake_ids = (area.index.get('strip') or {}).get('tiles', []) if a.tiles == 'strip' else [t.strip() for t in a.tiles.split(',')]
    area, stats = import_area.build(a.area, picks=picks_for(area, set(bake_ids), a.lod), sea=False, lights=False)
    device = setup_gpu(a.samples)
    scene = bpy.context.scene
    if scene.world is None:
        scene.world = bpy.data.worlds.new('ao_world')
    scene.world.light_settings.distance = a.distance
    out_dir = os.path.abspath(a.out)
    os.makedirs(out_dir, exist_ok=True)
    tiles = {t['id']: t for t in area.index['tiles']}
    objs = {o.get('tile'): o for o in bpy.data.collections['tiles'].objects if o.type == 'MESH'}
    report, baked = [], {}
    for tid in bake_ids:
        obj, tile = objs.get(tid), tiles.get(tid)
        if obj is None or tile is None or UV1 not in obj.data.uv_layers:
            log(f'skip {tid}: no mesh or no UV1')
            continue
        manifest = area.tile_manifest(tile)
        lod = next((l for l in manifest.get('lods', []) if l['level'] == a.lod), None) or {}
        lm = lod.get('lightmap') or {'size': 1024, 'padding': 2}
        size = min(lm['size'], a.max_size) if a.max_size else lm['size']
        out_path = os.path.join(out_dir, f'{tid}.lod{a.lod}.ao.png')
        img, secs = bake_tile(obj, size, lm.get('padding', 2), out_path)
        baked[tid] = img
        report.append({'tile': tid, 'lod': a.lod, 'file': os.path.relpath(out_path, ROOT), 'glbHash': lod.get('hash'), 'size': size, 'texelsPerM': round(lm.get('texelsPerM', 0) * size / lm['size'], 3) if lm.get('texelsPerM') else None, 'samples': a.samples, 'distance': a.distance, 'seconds': round(secs, 1)})
        log(f'{tid}: {size}px in {secs:.1f} s')
    with open(os.path.join(out_dir, 'ao.json'), 'w', encoding='utf-8') as f:
        json.dump({'area': a.area, 'indexHash': area.index.get('hash'), 'device': device, 'uv': 'TEXCOORD_1', 'tiles': report}, f, indent=1)
    if a.preview:
        cam = area.select_cameras(a.preview)[0]
        path = os.path.join(out_dir, f"{cam['id']}-ao-preview.png")
        preview(area, cam, baked, path)
        log('preview', os.path.relpath(path, ROOT))
    log('done', json.dumps({'tiles': len(report), 'seconds': round(sum(r['seconds'] for r in report), 1), 'import': stats}))


main()
