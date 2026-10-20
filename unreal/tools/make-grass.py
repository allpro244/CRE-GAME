# Make /Game/BW/Materials/M_BW_Grass: a world-aligned lawn for the parks.
# City Sample has no grass (its city is all paving), so this is ours: two
# scales of noise break the green into patches and wear, a third darkens the
# low spots, and "Season" (a colour) tints it from summer green through a
# tired late-summer olive to winter straw. CityBuilder sets Season by month.
#
#   UnrealEditor-Cmd.exe <BroadwayWall.uproject> -run=pythonscript -script="<this file>"
import unreal

PATH, NAME = "/Game/BW/Materials", "M_BW_Grass"
lib = unreal.MaterialEditingLibrary
tools = unreal.AssetToolsHelpers.get_asset_tools()
if unreal.EditorAssetLibrary.does_asset_exist(f"{PATH}/{NAME}"):
    unreal.EditorAssetLibrary.delete_asset(f"{PATH}/{NAME}")
mat = tools.create_asset(NAME, PATH, unreal.Material, unreal.MaterialFactoryNew())

def node(cls, x, y):
    return lib.create_material_expression(mat, cls, x, y)

wp = node(unreal.MaterialExpressionWorldPosition, -1400, 0)

def noise(scale, x, y, levels=4):
    n = node(unreal.MaterialExpressionNoise, x, y)
    n.set_editor_property("scale", scale)
    n.set_editor_property("levels", levels)
    n.set_editor_property("output_min", 0.0)
    n.set_editor_property("output_max", 1.0)
    n.set_editor_property("turbulence", True)
    lib.connect_material_expressions(wp, "", n, "Position")
    return n

big = noise(0.0012, -1100, -200)     # patches tens of metres across
mid = noise(0.012, -1100, 50)        # tufts and wear, a metre or so
fine = noise(0.08, -1100, 300, 2)    # blades' sparkle

a = node(unreal.MaterialExpressionVectorParameter, -800, -400)
a.set_editor_property("parameter_name", "GrassDark")
a.set_editor_property("default_value", unreal.LinearColor(0.035, 0.06, 0.018, 1))
b = node(unreal.MaterialExpressionVectorParameter, -800, -250)
b.set_editor_property("parameter_name", "GrassLight")
b.set_editor_property("default_value", unreal.LinearColor(0.09, 0.13, 0.035, 1))
season = node(unreal.MaterialExpressionVectorParameter, -800, -100)
season.set_editor_property("parameter_name", "Season")
season.set_editor_property("default_value", unreal.LinearColor(1, 1, 1, 1))

mix = node(unreal.MaterialExpressionMultiply, -800, 100)       # big x mid: patchy
lib.connect_material_expressions(big, "", mix, "A")
lib.connect_material_expressions(mid, "", mix, "B")
lerp = node(unreal.MaterialExpressionLinearInterpolate, -550, -250)
lib.connect_material_expressions(a, "", lerp, "A")
lib.connect_material_expressions(b, "", lerp, "B")
lib.connect_material_expressions(mix, "", lerp, "Alpha")
sparkle = node(unreal.MaterialExpressionLinearInterpolate, -550, 200)   # 0.85..1.1 brightness flicker
c0 = node(unreal.MaterialExpressionConstant, -800, 250); c0.set_editor_property("r", 0.85)
c1 = node(unreal.MaterialExpressionConstant, -800, 330); c1.set_editor_property("r", 1.1)
lib.connect_material_expressions(c0, "", sparkle, "A")
lib.connect_material_expressions(c1, "", sparkle, "B")
lib.connect_material_expressions(fine, "", sparkle, "Alpha")
m1 = node(unreal.MaterialExpressionMultiply, -300, -150)
lib.connect_material_expressions(lerp, "", m1, "A")
lib.connect_material_expressions(sparkle, "", m1, "B")
m2 = node(unreal.MaterialExpressionMultiply, -150, -150)
lib.connect_material_expressions(m1, "", m2, "A")
lib.connect_material_expressions(season, "", m2, "B")
lib.connect_material_property(m2, "", unreal.MaterialProperty.MP_BASE_COLOR)

rough = node(unreal.MaterialExpressionConstant, -300, 150); rough.set_editor_property("r", 0.92)
lib.connect_material_property(rough, "", unreal.MaterialProperty.MP_ROUGHNESS)
spec = node(unreal.MaterialExpressionConstant, -300, 230); spec.set_editor_property("r", 0.25)
lib.connect_material_property(spec, "", unreal.MaterialProperty.MP_SPECULAR)

lib.recompile_material(mat)
unreal.EditorAssetLibrary.save_asset(f"{PATH}/{NAME}")
unreal.log("GRASS made " + mat.get_path_name())
