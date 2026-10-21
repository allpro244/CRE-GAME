# Roof pieces the city builder instances (CityBuilder::DressRoof), built from boxes:
#   UnrealEditor-Cmd.exe <project> -run=pythonscript -script="<this>"
# SM_Penthouse: a tower's mechanical penthouse, a unit 100 cm cube (scaled per
#   building) clad in louvre bands with a coping, the machine room every real
#   tower carries on its roof.
# SM_Railing: one metre of terrace railing (top rail, mid rail, posts), laid
#   along the edges of a setback terrace.
import unreal

GS = unreal.GeometryScript_Primitives
UV = unreal.GeometryScript_UVs
ROOT = "/Game/BW/Roof"
MAT = "/Game/Building/Material/MI/Metal/ForGym/MI_Bldg_Metal_BrushedWorn_FG.MI_Bldg_Metal_BrushedWorn_FG"
DARK = "/Game/Building/Material/MI/Paint/ForGym/MI_Bldg_PaintedMetal_Black_FG.MI_Bldg_PaintedMetal_Black_FG"


def box(m, mid, x0, x1, y0, y1, z0, z1):
    o = unreal.GeometryScriptPrimitiveOptions()
    o.material_id = mid
    t = unreal.Transform(location=[(x0 + x1) / 2, (y0 + y1) / 2, z0], rotation=[0, 0, 0], scale=[1, 1, 1])
    GS.append_box(m, o, t, x1 - x0, y1 - y0, z1 - z0, 0, 0, 0, unreal.GeometryScriptPrimitiveOriginMode.BASE)


def save(m, name, mats):
    UV.set_mesh_u_vs_from_box_projection(m, 0, unreal.Transform(scale=[1.0, 1.0, 1.0]), unreal.GeometryScriptMeshSelection())
    o = unreal.GeometryScriptCreateNewStaticMeshAssetOptions()
    o.enable_recompute_normals = True
    o.enable_recompute_tangents = True
    o.enable_nanite = True
    o.enable_collision = False
    path = "%s/%s" % (ROOT, name)
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        unreal.EditorAssetLibrary.delete_asset(path)
    sm, _ = unreal.GeometryScript_NewAssetUtils.create_new_static_mesh_asset_from_mesh(m, path, o)
    sm.set_editor_property("static_materials", [unreal.StaticMaterial(material_interface=unreal.load_asset(p), material_slot_name=n) for n, p in mats])
    unreal.EditorAssetLibrary.save_loaded_asset(sm)


# penthouse: unit cube -50..50 in X/Y, 0..100 in Z
m = unreal.DynamicMesh()
box(m, 0, -50, 50, -50, 50, 0, 100)                  # the box
for z in range(8, 88, 8):                              # louvre bands, proud on every face
    box(m, 1, -51.5, 51.5, -51.5, 51.5, z, z + 3)
box(m, 0, -52, 52, -52, 52, 94, 100)                  # coping
save(m, "SM_Penthouse", [("wall", MAT), ("louvre", DARK)])

# railing: 100 cm long along X, 110 tall
m = unreal.DynamicMesh()
box(m, 0, 0, 100, -2, 2, 104, 110)                    # top rail
box(m, 0, 0, 100, -1.5, 1.5, 50, 53)                  # mid rail
box(m, 0, 0, 4, -2, 2, 0, 110)                        # a post every metre
save(m, "SM_Railing", [("steel", DARK)])
unreal.log("ROOF pieces built")

# CROWNS for the tall pre-war tower (a unit footprint, -50..50, scaled to the tower's top):
STONE = "/Game/Building/Material/MI/Block/ForGym/MI_Bldg_Block_Limestone_Beige_FG.MI_Bldg_Block_Limestone_Beige_FG"
COPPER = "/Game/Building/Material/MI/Metal/ForGym/MI_Bldg_Metal_CopperOx_FG.MI_Bldg_Metal_CopperOx_FG"
# stepped deco ziggurat: four receding stone tiers and a finial
m = unreal.DynamicMesh()
for k, (w, h) in enumerate([(100, 0), (80, 30), (60, 60), (40, 90), (22, 120)]):
    box(m, 0, -w / 2, w / 2, -w / 2, w / 2, h, h + 30)
box(m, 1, -4, 4, -4, 4, 150, 230)
save(m, "SM_Crown_Stepped", [("stone", STONE), ("finial", COPPER)])
# copper pyramid roof on a stone drum: stacked shrinking copper courses
m = unreal.DynamicMesh()
box(m, 0, -50, 50, -50, 50, 0, 20)
n = 14
for k in range(n):
    w = 100 * (1 - k / n)
    box(m, 1, -w / 2, w / 2, -w / 2, w / 2, 20 + k * 9, 29 + k * 9)
box(m, 1, -3, 3, -3, 3, 20 + n * 9, 20 + n * 9 + 40)
save(m, "SM_Crown_Pyramid", [("stone", STONE), ("copper", COPPER)])
# spire: a lantern on a drum, then a needle
m = unreal.DynamicMesh()
box(m, 0, -40, 40, -40, 40, 0, 40)
for k in range(4):
    box(m, 0, -30 + k * 4, 30 - k * 4, -30 + k * 4, 30 - k * 4, 40 + k * 25, 65 + k * 25)
box(m, 1, -6, 6, -6, 6, 140, 260)
box(m, 1, -2, 2, -2, 2, 260, 340)
save(m, "SM_Crown_Spire", [("stone", STONE), ("metal", COPPER)])
unreal.log("ROOF crowns built")

# ROOF LIFE: what a roof's era and use put on it
WOOD = "/Game/Building/Material/MI/Wood/ForGym/MI_Bldg_Wood_Cedar_FG.MI_Bldg_Wood_Cedar_FG"
GLASS = "/Game/Building/Material/MI/Glass/MI_Bldg_glass_opaque.MI_Bldg_glass_opaque"
GREEN = "/Game/Building/Material/MI/Paint/ForGym/MI_Bldg_PaintedMetal_Green_FG.MI_Bldg_PaintedMetal_Green_FG"
# an amenity deck: 10 x 6 m of decking, a pergola over half of it, planters on the edge (unit: cm, real size)
m = unreal.DynamicMesh()
box(m, 0, -500, 500, -300, 300, 0, 8)                         # decking
for x in (-480, -100):
    for y in (-280, 280):
        box(m, 1, x, x + 14, y - 7, y + 7, 8, 260)            # pergola posts
for k in range(12):
    x = -490 + k * 34
    box(m, 0, x, x + 8, -300, 300, 255, 268)                  # pergola slats
for x in range(-480, 480, 160):
    box(m, 1, x, x + 120, 300, 345, 8, 70)                    # planters
    box(m, 2, x + 5, x + 115, 305, 340, 70, 95)               # their green
save(m, "SM_RoofDeck", [("wood", WOOD), ("steel", DARK), ("green", GREEN)])
# a solar array: rows of panels tilted toward the sun (stepped, unit 10 x 6 m)
m = unreal.DynamicMesh()
for r in range(5):
    y0 = -300 + r * 120
    for k in range(4):                                        # the tilt as four steps
        box(m, 0, -500, 500, y0 + k * 22, y0 + (k + 1) * 22, 20 + k * 14, 26 + k * 14)
    box(m, 1, -500, 500, y0, y0 + 3, 0, 20)                   # the rack
save(m, "SM_SolarArray", [("panel", GLASS), ("rack", DARK)])
# a ridge skylight for a loft roof: 6 x 2 m, glass on a steel frame
m = unreal.DynamicMesh()
box(m, 1, -300, 300, -100, 100, 0, 30)
for k in range(5):
    w = 100 - k * 20
    box(m, 0, -290, 290, -w, w, 30 + k * 12, 42 + k * 12)
save(m, "SM_Skylight", [("glass", GLASS), ("frame", DARK)])
unreal.log("ROOF life built")

# CONTEMPORARY CROWNS (unit footprint -50..50, scaled to the tower's top)
MIRROR = "/Game/Building/Material/MI/Metal/MI_Bldg_Mirror.MI_Bldg_Mirror"
BRUSHED = "/Game/Building/Material/MI/Metal/ForGym/MI_Bldg_Metal_Brushed_FG.MI_Bldg_Metal_Brushed_FG"
# a sloped glass crown: the top steps in on one side in glass courses (the 1980s-2000s cut top)
m = unreal.DynamicMesh()
n = 10
for k in range(n):
    box(m, 0, -50, 50 - k * 9, -50, 50, k * 6, k * 6 + 6)
box(m, 1, -51, -49, -51, 51, 0, n * 6 + 4)                  # the frame at the back
save(m, "SM_Crown_GlassSlope", [("glass", MIRROR), ("frame", BRUSHED)])
# a mechanical screen: a band of vertical fins round the plant, the 2010s tower top
m = unreal.DynamicMesh()
box(m, 1, -46, 46, -46, 46, 0, 60)                          # the plant behind
for k in range(26):
    t = -50 + k * 4
    box(m, 0, t, t + 1.2, -50, -47, 0, 70)
    box(m, 0, t, t + 1.2, 47, 50, 0, 70)
    box(m, 0, -50, -47, t, t + 1.2, 0, 70)
    box(m, 0, 47, 50, t, t + 1.2, 0, 70)
box(m, 0, -50, 50, -50, 50, 68, 70)
save(m, "SM_Crown_Screen", [("fins", BRUSHED), ("plant", DARK)])
unreal.log("ROOF contemporary crowns built")



