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
