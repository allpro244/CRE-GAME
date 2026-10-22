# Ground covers for the open part of a lot (CityBuilder::ParcelGround), the
# surfaces City Sample has textures for but no material: world-aligned (a lot
# is a flat cap with no useful UVs), a "Tint" to vary them lot by lot, and a
# second, larger noise to break the repeat.
#   M_BW_Gravel        a gravel yard: the vacant lot, the contractor's yard
#   M_BW_WornConcrete  an old poured slab, cracked and stained: the loading yard
#   M_BW_Dirt          packed earth and sand: a cleared lot gone to seed
#
#   UnrealEditor-Cmd.exe <project> -run=pythonscript -script="<this>"
import unreal

lib = unreal.MaterialEditingLibrary
tools = unreal.AssetToolsHelpers.get_asset_tools()
PATH = "/Game/BW/Materials"
S = "/Game/Megascans/Surfaces/"


def make(name, albedo, normal, metres, tint):
    if unreal.EditorAssetLibrary.does_asset_exist(f"{PATH}/{name}"):
        unreal.EditorAssetLibrary.delete_asset(f"{PATH}/{name}")
    mat = tools.create_asset(name, PATH, unreal.Material, unreal.MaterialFactoryNew())

    def node(cls, x, y):
        return lib.create_material_expression(mat, cls, x, y)

    wp = node(unreal.MaterialExpressionWorldPosition, -1400, 0)
    xy = node(unreal.MaterialExpressionComponentMask, -1200, 0)
    xy.set_editor_property("r", True); xy.set_editor_property("g", True)
    xy.set_editor_property("b", False); xy.set_editor_property("a", False)
    lib.connect_material_expressions(wp, "", xy, "")
    sc = node(unreal.MaterialExpressionConstant, -1200, 120)
    sc.set_editor_property("r", 1.0 / (metres * 100.0))
    uv = node(unreal.MaterialExpressionMultiply, -1000, 40)
    lib.connect_material_expressions(xy, "", uv, "A")
    lib.connect_material_expressions(sc, "", uv, "B")

    def tex(path, x, y, normal=False):
        t = node(unreal.MaterialExpressionTextureSample, x, y)
        tx = unreal.load_asset(path)
        t.set_editor_property("texture", tx)
        # the Megascans imports stream as virtual textures, which need the virtual samplers
        virt = tx.get_editor_property("virtual_texture_streaming")
        T = unreal.MaterialSamplerType
        t.set_editor_property("sampler_type", (T.SAMPLERTYPE_VIRTUAL_NORMAL if virt else T.SAMPLERTYPE_NORMAL) if normal else (T.SAMPLERTYPE_VIRTUAL_COLOR if virt else T.SAMPLERTYPE_COLOR))
        lib.connect_material_expressions(uv, "", t, "UVs")
        return t

    a = tex(S + albedo, -800, -100)
    n = tex(S + normal, -800, 250, True)
    # a big soft patching (tens of metres) so a large lot is not one tile repeated
    nz = node(unreal.MaterialExpressionNoise, -800, -350)
    nz.set_editor_property("scale", 0.0015)
    nz.set_editor_property("levels", 3)
    nz.set_editor_property("output_min", 0.75)
    nz.set_editor_property("output_max", 1.15)
    lib.connect_material_expressions(wp, "", nz, "Position")
    t = node(unreal.MaterialExpressionVectorParameter, -800, -500)
    t.set_editor_property("parameter_name", "Tint")
    t.set_editor_property("default_value", unreal.LinearColor(*tint, 1))
    m1 = node(unreal.MaterialExpressionMultiply, -500, -200)
    lib.connect_material_expressions(a, "RGB", m1, "A")
    lib.connect_material_expressions(nz, "", m1, "B")
    m2 = node(unreal.MaterialExpressionMultiply, -300, -200)
    lib.connect_material_expressions(m1, "", m2, "A")
    lib.connect_material_expressions(t, "", m2, "B")
    lib.connect_material_property(m2, "", unreal.MaterialProperty.MP_BASE_COLOR)
    lib.connect_material_property(n, "RGB", unreal.MaterialProperty.MP_NORMAL)
    r = node(unreal.MaterialExpressionConstant, -300, 100)
    r.set_editor_property("r", 0.9)
    lib.connect_material_property(r, "", unreal.MaterialProperty.MP_ROUGHNESS)
    lib.recompile_material(mat)
    unreal.EditorAssetLibrary.save_asset(f"{PATH}/{name}")


make("M_BW_Gravel", "Gravel_Pebbledash_ugzmbcrn_2K_surface_ms/ugzmbcrn_2K_Albedo", "Gravel_Pebbledash_ugzmbcrn_2K_surface_ms/ugzmbcrn_2K_Normal", 2.0, (1.0, 0.97, 0.92))
make("M_BW_WornConcrete", "Concrete_Damaged_ueydffrdy/ueydffrdy_8K_Albedo", "Concrete_Damaged_ueydffrdy/ueydffrdy_8K_Normal", 4.0, (1.0, 1.0, 1.0))
make("M_BW_Dirt", "sand_sand_pjuuP0/pjuuP_4K_Albedo", "sand_sand_pjuuP0/pjuuP_4K_Normal", 3.0, (0.46, 0.40, 0.34))
unreal.log("GROUND covers made")
