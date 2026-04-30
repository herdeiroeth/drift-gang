"""Print transforms (location/rotation/dimensions) of mechanical parts.

Run: blender --background --python scripts/inspect_transforms.py
"""
import bpy

GLB_PATH = "/Users/ryantrunquim/projects/drift-game/public/models/bmw_m4_f82.glb"

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB_PATH)

# Update scene to compute world matrices
bpy.context.view_layer.update()

PARTS = [
    "ARm4_engine",
    "ARm4_engine_i6",
    "ARm4_enginebay",
    "ARm4_transmission",
    "ARm4_driveshaft",
    "ARm4_diff",
    "ARm4_diff_F",
    "ARm4_halfshaft_R",
    "ARm4_halfshaft_F",
    "ARm4_transfercase",
    "ARm4_header_i6",
    "ARm4_header_i6_turbo",
    "ARm4_exhaust_L",
    "ARm4_steer_carbon",
    "ARm4_steer_stick_msport",
    "ARm4_steeringbox",
    "ARm4_needle_speedo",
    "ARm4_needle_tacho",
    "ARm4_needle_fuel",
    "ARm4_needle_temp",
    "ARm4_hood",
    "ARm4_headlight_L_black",
    "ARm4_headlight_R_black",
    "ARm4_taillight_L_snake.001",
    "ARm4_taillight_R_snake.001",
    "ARm4_signalstalk",
    "Object_4.001",
    "Object_4.002",
    "Object_4.003",
    "Object_4.004",
]

print("\n=== TRANSFORMS (world space) ===")
print(f"{'Name':<40} {'X':>7} {'Y':>7} {'Z':>7}   {'dimX':>6} {'dimY':>6} {'dimZ':>6}   children")
for name in PARTS:
    obj = bpy.data.objects.get(name)
    if not obj:
        print(f"  {name}: NOT FOUND")
        continue
    wm = obj.matrix_world
    loc = wm.to_translation()
    # Compute bounds (world)
    if obj.type == "MESH":
        # bounds are in local — convert
        corners = [wm @ bpy.mathutils.Vector(c) for c in obj.bound_box] if hasattr(bpy, 'mathutils') else []
    # simpler: use obj.dimensions (local, ignoring rotation)
    dim = obj.dimensions
    nch = len(obj.children)
    print(f"  {name:<40} {loc.x:7.2f} {loc.y:7.2f} {loc.z:7.2f}   {dim.x:6.2f} {dim.y:6.2f} {dim.z:6.2f}   ({nch} children, type={obj.type})")
