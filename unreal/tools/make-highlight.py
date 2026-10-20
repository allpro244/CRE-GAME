# Make /Game/BW/Materials/M_BW_Highlight: the selection band's material. Unlit,
# its emissive the mesh's vertex colour times Glow (CityBuilder::SetHighlight colours gold
# for the selected lot, white for hover, above 1 so it glows in daylight), and
# it ignores fog and depth of field so the band reads at any distance.
#
#   UnrealEditor-Cmd.exe <BroadwayWall.uproject> -run=pythonscript -script="<this file>"
import unreal

PATH, NAME = "/Game/BW/Materials", "M_BW_Highlight"
lib = unreal.MaterialEditingLibrary
if unreal.EditorAssetLibrary.does_asset_exist(f"{PATH}/{NAME}"):
    unreal.EditorAssetLibrary.delete_asset(f"{PATH}/{NAME}")
mat = unreal.AssetToolsHelpers.get_asset_tools().create_asset(NAME, PATH, unreal.Material, unreal.MaterialFactoryNew())
mat.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
mat.set_editor_property("two_sided", True)
vc = lib.create_material_expression(mat, unreal.MaterialExpressionVertexColor, -600, 0)
# vertex colour tops out at 1; daylight exposure (EV 13-15) wants emissive in the
# thousands to read as lit, so "Glow" scales it (the game sets it per weather)
glow = lib.create_material_expression(mat, unreal.MaterialExpressionScalarParameter, -600, 200)
glow.set_editor_property("parameter_name", "Glow")
glow.set_editor_property("default_value", 1200.0)
mul = lib.create_material_expression(mat, unreal.MaterialExpressionMultiply, -300, 0)
lib.connect_material_expressions(vc, "", mul, "A")
lib.connect_material_expressions(glow, "", mul, "B")
lib.connect_material_property(mul, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
lib.recompile_material(mat)
unreal.EditorAssetLibrary.save_asset(f"{PATH}/{NAME}")
unreal.log("HIGHLIGHT made " + mat.get_path_name())
