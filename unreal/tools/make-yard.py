# What stands on a lot's edges and in its yard (CityBuilder::BuildGround):
#   SM_ChainLink  3 m of chain-link fence, 1.8 m: galvanised posts, top and
#                 bottom rails, the mesh as a fine grid of wires. Round a
#                 vacant lot, as a city requires of an owner.
#   SM_Hedge      1 m of clipped privet, 0.9 m tall: a front garden's edge.
#   SM_Dumpster   a 4-yard front-load container (1.8 x 1.1 x 1.2 m), lid
#                 sloped back: in the service yard of every building that
#                 has one.
#
#   UnrealEditor-Cmd.exe <project> -run=pythonscript -script="<this>"
import unreal

GS = unreal.GeometryScript_Primitives
UV = unreal.GeometryScript_UVs
ROOT = "/Game/BW/Yard"
STEEL = "/Game/Building/Material/MI/Metal/ForGym/MI_Bldg_Metal_BrushedWorn_FG.MI_Bldg_Metal_BrushedWorn_FG"
GREEN = "/Game/Building/Material/MI/Paint/ForGym/MI_Bldg_PaintedMetal_Green_FG.MI_Bldg_PaintedMetal_Green_FG"
DARK = "/Game/Building/Material/MI/Paint/ForGym/MI_Bldg_PaintedMetal_Black_FG.MI_Bldg_PaintedMetal_Black_FG"
LEAVES = "/Game/BW/Materials/M_BW_Leaves.M_BW_Leaves"


def box(m, mid, x0, x1, y0, y1, z0, z1, rot=(0, 0, 0)):
    o = unreal.GeometryScriptPrimitiveOptions()
    o.material_id = mid
    t = unreal.Transform(location=[(x0 + x1) / 2, (y0 + y1) / 2, z0], rotation=list(rot), scale=[1, 1, 1])
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
    ns = sm.get_editor_property("nanite_settings")      # the create option does not take: set on the asset
    ns.enabled = True
    sm.set_editor_property("nanite_settings", ns)
    unreal.EditorAssetLibrary.save_loaded_asset(sm)


# chain-link: 300 cm along X, a post at 0 (the next panel's post closes it)
m = unreal.DynamicMesh()
box(m, 0, -3, 3, -3, 3, 0, 185)                 # post
box(m, 0, 0, 300, -2, 2, 176, 180)              # top rail
box(m, 0, 0, 300, -1, 1, 8, 10)                 # bottom wire
for x in range(10, 300, 10):                    # the mesh: 10 cm diamonds read as a grid at this scale
    box(m, 0, x - 0.3, x + 0.3, -0.3, 0.3, 8, 176)
for z in range(18, 176, 10):
    box(m, 0, 0, 300, -0.3, 0.3, z - 0.3, z + 0.3)
save(m, "SM_ChainLink", [("steel", STEEL)])

# hedge: 100 cm along X, 90 tall, 60 deep, slightly rounded top
m = unreal.DynamicMesh()
box(m, 0, 0, 100, -30, 30, 0, 80)
box(m, 0, 0, 100, -24, 24, 80, 92)
save(m, "SM_Hedge", [("leaves", LEAVES)])

# dumpster: centred, 180 x 110 x 120, lid sloping down to the back
m = unreal.DynamicMesh()
box(m, 1, -90, 90, -55, 55, 12, 112)            # body
box(m, 1, -95, 95, -58, -50, 30, 40)            # front lifting pocket
box(m, 0, -92, 92, -60, 60, 110, 122, (-4, 0, 0))   # lid
for x in (-75, 75):                             # castors
    for y in (-40, 40):
        box(m, 0, x - 6, x + 6, y - 6, y + 6, 0, 12)
save(m, "SM_Dumpster", [("dark", DARK), ("paint", GREEN)])
unreal.log("YARD pieces built")
