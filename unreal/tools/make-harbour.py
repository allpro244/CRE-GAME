# The working harbour (CityBuilder::BuildGround, the waterfront):
#   SM_PierDeck   a unit pier deck (1 m x 1 m plan, 1 m deep, top at z=0),
#                 scaled per pier: poured concrete on its pile caps
#   SM_Piling     one timber pile, 40 cm, 3 m, top at z=0
#   SM_Tug        a harbour tug, 28 m: black hull, red sheer, white house,
#                 wheelhouse high forward, a stack
#   SM_Ferry      a commuter ferry, 45 m: white, two decks, dark windows
#   SM_Barge      a deck barge, 60 m, low and rust-red, with a load of
#                 containers
#   SM_Sailboat   a 10 m sloop: white hull, a mast
# Waterline at z=0; hulls are boxes stepped in at the bow so a hull reads
# as a hull from the air.
#
#   UnrealEditor-Cmd.exe <project> -run=pythonscript -script="<this>"
import unreal

GS = unreal.GeometryScript_Primitives
UV = unreal.GeometryScript_UVs
ROOT = "/Game/BW/Harbour"
P = "/Game/Building/Material/MI/"
CONC = P + "Paint/MI_Bldg_PaintedStone_Beige.MI_Bldg_PaintedStone_Beige"
WOOD = P + "Wood/ForGym/MI_Bldg_Wood_Cedar_FG.MI_Bldg_Wood_Cedar_FG"
WHITE = P + "Paint/MI_Bldg_PaintedStone_White.MI_Bldg_PaintedStone_White"
BLACK = P + "Paint/ForGym/MI_Bldg_PaintedMetal_Black_FG.MI_Bldg_PaintedMetal_Black_FG"
RED = P + "Paint/MI_Bldg_PaintedMetal_Red.MI_Bldg_PaintedMetal_Red"
GREEN = P + "Paint/MI_Bldg_PaintedMetal_Green.MI_Bldg_PaintedMetal_Green"
GLASS = P + "Glass/MI_Bldg_glass_opaque.MI_Bldg_glass_opaque"


def box(m, mid, x0, x1, y0, y1, z0, z1):
    o = unreal.GeometryScriptPrimitiveOptions()
    o.material_id = mid
    t = unreal.Transform(location=[(x0 + x1) / 2, (y0 + y1) / 2, z0], rotation=[0, 0, 0], scale=[1, 1, 1])
    GS.append_box(m, o, t, x1 - x0, y1 - y0, z1 - z0, 0, 0, 0, unreal.GeometryScriptPrimitiveOriginMode.BASE)


def hull(m, mid, length, beam, z0, z1, bow=0.22):
    """A hull along +X (bow at +X): the body, then four steps narrowing to the stem."""
    body = length * (1 - bow)
    box(m, mid, -length / 2, -length / 2 + body, -beam / 2, beam / 2, z0, z1)
    seg = length * bow / 4
    for k in range(4):
        w = beam * (1 - (k + 1) / 5.0)
        x = -length / 2 + body + k * seg
        box(m, mid, x, x + seg, -w / 2, w / 2, z0 + k * 8, z1)


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
    ns = sm.get_editor_property("nanite_settings")      # the create option does not take: set on the asset
    ns.enabled = True
    sm.set_editor_property("nanite_settings", ns)
    unreal.EditorAssetLibrary.save_loaded_asset(sm)


m = unreal.DynamicMesh()
box(m, 0, -50, 50, -50, 50, -100, 0)
save(m, "SM_PierDeck", [("concrete", CONC)])

m = unreal.DynamicMesh()
box(m, 0, -20, 20, -20, 20, -300, 0)
save(m, "SM_Piling", [("timber", WOOD)])

# tug: 2800 x 900; hull black to the waterline, a red band, white house
m = unreal.DynamicMesh()
hull(m, 0, 2800, 900, -150, 180)
hull(m, 1, 2820, 920, 150, 200)
box(m, 2, -900, 500, -330, 330, 200, 450)       # deckhouse
box(m, 2, 0, 500, -250, 250, 450, 700)          # wheelhouse
box(m, 3, 10, 490, -255, 255, 560, 660)         # wheelhouse windows
box(m, 0, -500, -300, -90, 90, 450, 850)        # stack
box(m, 1, -500, -300, -95, 95, 760, 820)        # stack band
save(m, "SM_Tug", [("hull", BLACK), ("band", RED), ("house", WHITE), ("glass", GLASS)])

# ferry: 4500 x 1200, white, two passenger decks with window bands
m = unreal.DynamicMesh()
hull(m, 0, 4500, 1200, -120, 200, 0.15)
box(m, 1, -2000, 1600, -560, 560, 200, 480)
box(m, 2, -1980, 1580, -565, 565, 300, 430)
box(m, 1, -1600, 1200, -520, 520, 480, 740)
box(m, 2, -1580, 1180, -525, 525, 560, 700)
box(m, 1, 400, 1000, -300, 300, 740, 960)       # wheelhouse
box(m, 2, 420, 990, -305, 305, 820, 920)
save(m, "SM_Ferry", [("hull", BLACK), ("house", WHITE), ("glass", GLASS)])

# barge: 6000 x 1500, low, carrying two rows of containers
m = unreal.DynamicMesh()
hull(m, 0, 6000, 1500, -200, 150, 0.08)
cols = [1, 2, 3, 1, 2]
for i in range(5):
    x = -2600 + i * 1100
    for j, y in enumerate((-370, 370)):
        box(m, cols[(i + j) % 5], x, x + 1000, y - 240, y + 240, 150, 410)
save(m, "SM_Barge", [("hull", RED), ("box1", GREEN), ("box2", WHITE), ("box3", BLACK)])

# sloop: 1000 x 330, white hull, a cabin, a mast
m = unreal.DynamicMesh()
hull(m, 0, 1000, 330, -60, 90, 0.3)
box(m, 0, -250, 150, -110, 110, 90, 160)
box(m, 1, 100, 110, -5, 5, 90, 1350)
save(m, "SM_Sailboat", [("hull", WHITE), ("mast", BLACK)])
unreal.log("HARBOUR built")
