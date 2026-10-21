# Extra facade colours derived from the City Sample building library:
#   UnrealEditor-Cmd.exe <project> -run=pythonscript -script="<this>"
# The "ForGym" instances take a colour multiplier (Color Tint/Mult(A) M1), so a
# white painted panel tinted becomes the orange fibre-cement, sage or navy
# panel a contemporary rental is clad in. Each lands at /Game/BW/Mats/MI_BW_<Name>
# and a recipe names it by full path (or "BW/<Name>" in styles.json).
import unreal

LIB = "/Game/Building/Material/MI/%s/ForGym/MI_Bldg_%s_FG"
# name: (parent folder/short, rgb multiplier)
MATS = {
    "FibreCementOrange": ("Paint/PaintedStone_White", (1.00, 0.52, 0.30)),
    "FibreCementRust": ("Paint/PaintedStone_White", (0.72, 0.36, 0.22)),
    "PanelSage": ("Paint/PaintedMetal_White", (0.62, 0.70, 0.58)),
    "PanelNavy": ("Paint/PaintedMetal_White", (0.22, 0.28, 0.42)),
    "PanelWarmGrey": ("Paint/PaintedMetal_White", (0.66, 0.63, 0.58)),
    "PanelTeal": ("Paint/PaintedMetal_White", (0.30, 0.52, 0.52)),
    "PanelMustard": ("Paint/PaintedMetal_White", (0.86, 0.68, 0.30)),
    "StuccoCream": ("Paint/PaintedStone_White", (0.96, 0.90, 0.78)),
    "StuccoTerracotta": ("Paint/PaintedStone_White", (0.86, 0.55, 0.42)),
    "BrickCharcoal": ("Brick/BrickOffset_Brown", (0.45, 0.43, 0.42)),
    "BrickGlazedWhite": ("Brick/BrickOffset_White", (1.08, 1.08, 1.06)),
    "BrickOrange": ("Brick/BrickOffset_Red", (1.15, 0.85, 0.62)),
    "LimestoneWarm": ("Block/Block_Limestone_Beige", (1.05, 0.98, 0.88)),
    "ConcreteWarm": ("Concrete/Concrete", (1.02, 0.96, 0.88)),
}
P = unreal.Name("Color Tint/Mult(A) M1")
tools = unreal.AssetToolsHelpers.get_asset_tools()
lib = unreal.MaterialEditingLibrary
n = 0
for name, (src, rgb) in MATS.items():
    folder, short = src.split("/")
    parent = unreal.load_asset(LIB % (folder, short))
    if not parent:
        unreal.log_warning("MATS missing parent %s" % src)
        continue
    path = "/Game/BW/Mats/MI_BW_%s" % name
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        mi = unreal.load_asset(path)
    else:
        mi = tools.create_asset("MI_BW_%s" % name, "/Game/BW/Mats", unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
    mi.set_editor_property("parent", parent)
    cur = lib.get_material_instance_vector_parameter_value(parent, P)
    lib.set_material_instance_vector_parameter_value(mi, P, unreal.LinearColor(cur.r * rgb[0], cur.g * rgb[1], cur.b * rgb[2], cur.a))
    lib.update_material_instance(mi)
    unreal.EditorAssetLibrary.save_loaded_asset(mi)
    n += 1
unreal.log("MATS %d built" % n)
