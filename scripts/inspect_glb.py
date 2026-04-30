"""Inspect bmw_m4_f82.glb hierarchy: list every node, mesh, material.

Run: blender --background --python scripts/inspect_glb.py
"""
import bpy
import os
import sys

GLB_PATH = "/Users/ryantrunquim/projects/drift-game/public/models/bmw_m4_f82.glb"

# Limpa cena default
bpy.ops.wm.read_factory_settings(use_empty=True)

# Importa GLB
bpy.ops.import_scene.gltf(filepath=GLB_PATH)

print("\n=== TOP-LEVEL OBJECTS ===")
top_level = [o for o in bpy.data.objects if o.parent is None]
for o in sorted(top_level, key=lambda x: x.name):
    print(f"  {o.name} ({o.type})")

def walk(o, depth=0):
    pad = "  " * depth
    info = f"{pad}{o.name} ({o.type}"
    if o.type == "MESH" and o.data:
        info += f", verts={len(o.data.vertices)}, polys={len(o.data.polygons)}"
        if o.data.materials:
            mats = ",".join(m.name for m in o.data.materials if m)
            info += f", mat=[{mats}]"
    info += ")"
    print(info)
    for c in sorted(o.children, key=lambda x: x.name):
        walk(c, depth + 1)

print("\n=== HIERARCHY ===")
for o in sorted(top_level, key=lambda x: x.name):
    walk(o)

print("\n=== ALL OBJECT NAMES (alphabetical) ===")
names = sorted(o.name for o in bpy.data.objects)
for n in names:
    print(f"  {n}")

print(f"\nTotal objects: {len(names)}")
print(f"Total meshes: {sum(1 for o in bpy.data.objects if o.type == 'MESH')}")
print(f"Total empties: {sum(1 for o in bpy.data.objects if o.type == 'EMPTY')}")
