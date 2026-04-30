"""Inspect children meshes of mechanical parts (transforms + dimensions)."""
import bpy

GLB_PATH = "/Users/ryantrunquim/projects/drift-game/public/models/bmw_m4_f82.glb"
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB_PATH)
bpy.context.view_layer.update()

PARTS = [
    "ARm4_engine",
    "ARm4_engine_i6",
    "ARm4_transmission",
    "ARm4_driveshaft",
    "ARm4_diff",
    "ARm4_halfshaft_R",
    "ARm4_steer_carbon",
    "ARm4_needle_tacho",
    "ARm4_needle_speedo",
    "Object_4.001",
    "Object_4.002",
    "Object_4.003",
    "Object_4.004",
]

print("\n=== CHILDREN ===")
for parent_name in PARTS:
    parent = bpy.data.objects.get(parent_name)
    if not parent:
        continue
    print(f"\n[{parent_name}] world_pos={tuple(round(v,3) for v in parent.matrix_world.to_translation())}")
    for child in parent.children:
        wm = child.matrix_world
        loc = wm.to_translation()
        rot = wm.to_euler()
        if child.type == "MESH" and child.data:
            verts = len(child.data.vertices)
            polys = len(child.data.polygons)
            local_dim = child.dimensions
            print(f"  └ {child.name} type={child.type} loc=({loc.x:.2f},{loc.y:.2f},{loc.z:.2f}) "
                  f"rot=({rot.x:.2f},{rot.y:.2f},{rot.z:.2f}) "
                  f"dim=({local_dim.x:.2f},{local_dim.y:.2f},{local_dim.z:.2f}) "
                  f"v={verts} p={polys}")
        else:
            print(f"  └ {child.name} type={child.type} loc=({loc.x:.2f},{loc.y:.2f},{loc.z:.2f})")
