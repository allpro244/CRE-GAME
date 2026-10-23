# The traffic City Sample does not have (CityLife adds them to the moving cars):
#   SM_Bus       a 40 ft transit bus, 12.2 x 2.6 x 3.1 m: white, a blue band,
#                the window band, wheels
#   SM_BoxTruck  a 26 ft box truck, 9 x 2.5 x 3.4 m: a white cab and box
# Along +X, centred, sitting on z = -14 (the cars ride at z = 14 on the road).
#
#   UnrealEditor-Cmd.exe <project> -run=pythonscript -script="<this>"
import unreal

GS = unreal.GeometryScript_Primitives
UV = unreal.GeometryScript_UVs
ROOT = "/Game/BW/Fleet"
P = "/Game/Building/Material/MI/"
WHITE = P + "Paint/MI_Bldg_PaintedStone_White.MI_Bldg_PaintedStone_White"
BLUE = P + "Paint/MI_Bldg_PaintedMetal_Green.MI_Bldg_PaintedMetal_Green"
GLASS = P + "Glass/MI_Bldg_glass_opaque.MI_Bldg_glass_opaque"
TYRE = P + "Paint/ForGym/MI_Bldg_PaintedMetal_Black_FG.MI_Bldg_PaintedMetal_Black_FG"
RED = P + "Paint/MI_Bldg_PaintedMetal_Red.MI_Bldg_PaintedMetal_Red"
Z = -14


def box(m, mid, x0, x1, y0, y1, z0, z1):
    o = unreal.GeometryScriptPrimitiveOptions()
    o.material_id = mid
    t = unreal.Transform(location=[(x0 + x1) / 2, (y0 + y1) / 2, z0 + Z], rotation=[0, 0, 0], scale=[1, 1, 1])
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


def wheels(m, xs, half_w):
    for x in xs:
        for y in (-half_w, half_w - 30):
            box(m, 3, x - 50, x + 50, y, y + 30, 0, 100)


# bus: 1220 long, 255 wide, 310 tall
m = unreal.DynamicMesh()
box(m, 0, -610, 610, -127, 127, 35, 310)        # body
box(m, 1, -612, 612, -129, 129, 60, 95)         # blue band at the skirt
box(m, 2, -540, 600, -129, 129, 150, 260)       # window band
box(m, 2, 595, 612, -110, 110, 120, 280)        # windscreen
box(m, 0, -300, 100, -100, 100, 310, 335)       # roof pods (HVAC)
wheels(m, (-380, 420), 128)
save(m, "SM_Bus", [("body", WHITE), ("band", BLUE), ("glass", GLASS), ("tyre", TYRE)])

# box truck: 900 long; the cab forward (+X)
m = unreal.DynamicMesh()
box(m, 0, -450, 170, -125, 125, 60, 340)        # the box
box(m, 1, -452, 172, -127, 127, 270, 300)       # a livery stripe
box(m, 0, 180, 450, -115, 115, 50, 260)         # cab
box(m, 2, 440, 452, -100, 100, 160, 245)        # windscreen
box(m, 2, 250, 420, -117, 117, 170, 240)        # side windows
wheels(m, (-320, -200, 340), 125)
save(m, "SM_BoxTruck", [("body", WHITE), ("stripe", RED), ("glass", GLASS), ("tyre", TYRE)])
unreal.log("FLEET built")
