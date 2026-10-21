# Houses for the region expansion's suburbs (CityBuilder: volumes with deco
# "house"), one instanced mesh per type so tens of thousands of houses cost a
# handful of draw calls. Each is a unit footprint, 100 x 100 cm along X (the
# ridge) and Y, walls 0-300 and a 30-degree gable roof to ~330; the builder
# scales it to the house's footprint and storeys.
#   SM_House_Cream   stucco, the post-war ranch
#   SM_House_Sage    painted siding
#   SM_House_Navy    painted siding, the 1980s colonial
#   SM_House_Brick   red-orange brick, the pre-war bungalow
#   SM_House_Grey    warm grey panel, the recent build
#
#   UnrealEditor-Cmd.exe <project> -run=pythonscript -script="<this>"
import unreal

GS = unreal.GeometryScript_Primitives
UV = unreal.GeometryScript_UVs
ROOT = "/Game/BW/Houses"
M = "/Game/BW/Mats/"
ROOF = "/Game/Building/Material/MI/Paint/ForGym/MI_Bldg_PaintedMetal_Black_FG.MI_Bldg_PaintedMetal_Black_FG"
TRIM = "/Game/Building/Material/MI/Paint/MI_Bldg_PaintedStone_White.MI_Bldg_PaintedStone_White"
GLASS = "/Game/Building/Material/MI/Glass/MI_Bldg_glass_opaque.MI_Bldg_glass_opaque"


def box(m, mid, x0, x1, y0, y1, z0, z1, roll=0.0):
    o = unreal.GeometryScriptPrimitiveOptions()
    o.material_id = mid
    t = unreal.Transform(location=[(x0 + x1) / 2, (y0 + y1) / 2, z0], rotation=[roll, 0, 0], scale=[1, 1, 1])
    GS.append_box(m, o, t, x1 - x0, y1 - y0, z1 - z0, 0, 0, 0, unreal.GeometryScriptPrimitiveOriginMode.BASE)


def house(name, wall):
    m = unreal.DynamicMesh()
    box(m, 0, -50, 50, -50, 50, 0, 300)                 # walls
    # the gable roof: two planes pitched 30 degrees, overhanging 6 cm
    for side in (-1, 1):
        box(m, 1, -56, 56, side * 28 - 29, side * 28 + 29, 300, 304, roll=-side * 30)
    box(m, 1, -56, 56, -3, 3, 326, 334)                 # the ridge
    box(m, 2, -51, 51, -51, 51, 0, 14)                  # foundation/trim band
    for x in (-30, 10):                                 # windows on both long sides
        for y in (-51, 50):
            box(m, 3, x - 9, x + 9, y, y + 1, 110, 210)
    box(m, 2, 30, 44, -51.5, -50, 0, 220)               # the front door
    box(m, 1, -20, -10, 15, 25, 300, 360)               # chimney
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
    mats = [("wall", wall), ("roof", ROOF), ("trim", TRIM), ("glass", GLASS)]
    sm.set_editor_property("static_materials", [unreal.StaticMaterial(material_interface=unreal.load_asset(p), material_slot_name=n) for n, p in mats])
    ns = sm.get_editor_property("nanite_settings")      # the create option does not take: set on the asset
    ns.enabled = True
    sm.set_editor_property("nanite_settings", ns)
    unreal.EditorAssetLibrary.save_loaded_asset(sm)


house("SM_House_Cream", M + "MI_BW_StuccoCream.MI_BW_StuccoCream")
house("SM_House_Sage", M + "MI_BW_PanelSage.MI_BW_PanelSage")
house("SM_House_Navy", M + "MI_BW_PanelNavy.MI_BW_PanelNavy")
house("SM_House_Brick", M + "MI_BW_BrickOrange.MI_BW_BrickOrange")
house("SM_House_Grey", M + "MI_BW_PanelWarmGrey.MI_BW_PanelWarmGrey")
unreal.log("HOUSES built")
