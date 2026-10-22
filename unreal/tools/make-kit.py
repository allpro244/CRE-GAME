# THE BUILDING KIT: real-size pieces the C++ builders (RetailBuilder, next the
# houses and the sheds) instance along a footprint's edges. Everything is
# generated here from the City Sample and BW materials already in Content/;
# nothing is copied from a third-party pack.
#
#   UnrealEditor-Cmd.exe <project> -run=pythonscript -script="<this>"
#
# CONVENTIONS (RetailBuilder.cpp reads them):
#   - centimetres; X along the wall, centred on 0 unless noted; Y out of the
#     wall (0 = the wall's face, +Y toward the car park); Z up from the ground.
#   - every mesh carries the same eight material slots, by name, so a builder
#     can recolour any piece per instanced component:
#       wall    the piece's masonry or render (piers, towers, bodies)
#       trim    coping, cornices, sills, kerbs
#       metal   storefront framing (dark bronze by default)
#       glass   glazing
#       fabric  awnings
#       accent  sign faces, doors, a trailer's box, a dumpster
#       dark    rubber, shadow, tyres
#       roof    a metal roof (standing seam)
#   - Nanite on, no collision (the volume's own mass takes the clicks).
#
#   /Game/BW/Kit     shared pieces (unit cube, column, pyramid, man door, dock
#                    door, trailer, ground condenser)
#   /Game/BW/Retail  retail pieces (storefront bay, pier, awnings, sign
#                    raceway, entry tower, anchor portal, pylon, pump island,
#                    cart corral, menu board) and the retail colours
import math
import unreal

GS = unreal.GeometryScript_Primitives
UV = unreal.GeometryScript_UVs
EAL = unreal.EditorAssetLibrary
MEL = unreal.MaterialEditingLibrary
KIT = "/Game/BW/Kit"
RET = "/Game/BW/Retail"
MATS = "/Game/BW/Retail/Mats"
FG = "/Game/Building/Material/MI/%s/ForGym/MI_Bldg_%s_FG.MI_Bldg_%s_FG"


def fg(folder, name):
    return FG % (folder, name, name)


# ------------------------------------------------------------------ colours
TINT = unreal.Name("Color Tint/Mult(A) M1")
tools = unreal.AssetToolsHelpers.get_asset_tools()


def tinted(name, folder, parent, rgb):
    """A colour of a City Sample "ForGym" instance (they take a tint multiplier), at MATS/MI_RK_<name>."""
    base = unreal.load_asset(fg(folder, parent))
    if not base:
        unreal.log_warning("KIT missing parent %s" % parent)
        return None
    path = "%s/MI_RK_%s" % (MATS, name)
    mi = unreal.load_asset(path) if EAL.does_asset_exist(path) else tools.create_asset("MI_RK_%s" % name, MATS, unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
    mi.set_editor_property("parent", base)
    cur = MEL.get_material_instance_vector_parameter_value(base, TINT)
    MEL.set_material_instance_vector_parameter_value(mi, TINT, unreal.LinearColor(cur.r * rgb[0], cur.g * rgb[1], cur.b * rgb[2], cur.a))
    MEL.update_material_instance(mi)
    EAL.save_loaded_asset(mi)
    return mi


# awning canvas (a matte painted render, darkened to dyed acrylic), renders, metals
COLOURS = {
    "AwningRed": ("Paint", "PaintedStone_White", (0.55, 0.07, 0.06)),
    "AwningGreen": ("Paint", "PaintedStone_White", (0.06, 0.26, 0.12)),
    "AwningNavy": ("Paint", "PaintedStone_White", (0.06, 0.09, 0.24)),
    "AwningBurgundy": ("Paint", "PaintedStone_White", (0.30, 0.05, 0.08)),
    "AwningTan": ("Paint", "PaintedStone_White", (0.58, 0.46, 0.30)),
    "AwningTeal": ("Paint", "PaintedStone_White", (0.05, 0.28, 0.30)),
    "EifsTan": ("Paint", "PaintedStone_White", (0.86, 0.75, 0.58)),
    "EifsSand": ("Paint", "PaintedStone_White", (0.93, 0.86, 0.72)),
    "EifsGrey": ("Paint", "PaintedStone_White", (0.70, 0.69, 0.66)),
    "EifsWhite": ("Paint", "PaintedStone_White", (0.97, 0.95, 0.91)),
    "EifsTerracotta": ("Paint", "PaintedStone_White", (0.78, 0.50, 0.38)),
    "EifsSage": ("Paint", "PaintedStone_White", (0.62, 0.66, 0.55)),
    "Bronze": ("Paint", "PaintedMetal_White", (0.10, 0.085, 0.07)),
    "Membrane": ("Paint", "PaintedStone_White", (0.78, 0.78, 0.76)),
    "RoofBlue": ("Paint", "PaintedMetal_White", (0.10, 0.18, 0.34)),
    "RoofCharcoal": ("Paint", "PaintedMetal_White", (0.16, 0.16, 0.17)),
    "BrandRed": ("Paint", "PaintedMetal_White", (0.70, 0.06, 0.05)),
    "BrandYellow": ("Paint", "PaintedMetal_White", (0.95, 0.70, 0.08)),
    "BrandBlue": ("Paint", "PaintedMetal_White", (0.06, 0.16, 0.50)),
    "BrandGreen": ("Paint", "PaintedMetal_White", (0.05, 0.38, 0.14)),
    "DumpsterBlue": ("Paint", "PaintedMetal_White", (0.08, 0.20, 0.42)),
    "Asphalt": ("Paint", "PaintedStone_White", (0.11, 0.11, 0.12)),
}
for k, (folder, parent, rgb) in COLOURS.items():
    tinted(k, folder, parent, rgb)


def glow_material():
    """M_RK_Glow: a lit sign face that also gives light (backlit acrylic): Color, and Glow (emissive strength)."""
    path = "%s/M_RK_Glow" % MATS
    if EAL.does_asset_exist(path):
        EAL.delete_asset(path)
    m = tools.create_asset("M_RK_Glow", MATS, unreal.Material, unreal.MaterialFactoryNew())
    col = MEL.create_material_expression(m, unreal.MaterialExpressionVectorParameter, -600, 0)
    col.set_editor_property("parameter_name", "Color")
    col.set_editor_property("default_value", unreal.LinearColor(1, 1, 1, 1))
    glow = MEL.create_material_expression(m, unreal.MaterialExpressionScalarParameter, -600, 250)
    glow.set_editor_property("parameter_name", "Glow")
    glow.set_editor_property("default_value", 4.0)
    mul = MEL.create_material_expression(m, unreal.MaterialExpressionMultiply, -300, 150)
    MEL.connect_material_expressions(col, "", mul, "A")
    MEL.connect_material_expressions(glow, "", mul, "B")
    rough = MEL.create_material_expression(m, unreal.MaterialExpressionConstant, -300, 350)
    rough.set_editor_property("r", 0.35)
    MEL.connect_material_property(col, "", unreal.MaterialProperty.MP_BASE_COLOR)
    MEL.connect_material_property(mul, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    MEL.connect_material_property(rough, "", unreal.MaterialProperty.MP_ROUGHNESS)
    m.set_editor_property("used_with_instanced_static_meshes", True)
    m.set_editor_property("used_with_nanite", True)
    MEL.recompile_material(m)
    EAL.save_loaded_asset(m)
    for name, rgb, g in (("White", (1.0, 0.98, 0.94), 3.0), ("Red", (0.85, 0.05, 0.04), 6.0), ("Blue", (0.05, 0.18, 0.75), 6.0),
                         ("Yellow", (1.0, 0.72, 0.05), 4.0), ("Green", (0.05, 0.55, 0.15), 6.0), ("Orange", (1.0, 0.35, 0.03), 5.0)):
        p = "%s/MI_RK_Glow%s" % (MATS, name)
        mi = unreal.load_asset(p) if EAL.does_asset_exist(p) else tools.create_asset("MI_RK_Glow%s" % name, MATS, unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
        mi.set_editor_property("parent", m)
        MEL.set_material_instance_vector_parameter_value(mi, "Color", unreal.LinearColor(rgb[0], rgb[1], rgb[2], 1))
        MEL.set_material_instance_scalar_parameter_value(mi, "Glow", g)
        MEL.update_material_instance(mi)
        EAL.save_loaded_asset(mi)


glow_material()

# ------------------------------------------------------------------ geometry
M = lambda n: "%s/MI_RK_%s.MI_RK_%s" % (MATS, n, n)
SLOTS = [
    ("wall", M("EifsTan")),
    ("trim", fg("Paint", "PaintedStone_White")),
    ("metal", M("Bronze")),
    ("glass", "/Game/Building/Material/MI/Glass/MI_Bldg_glass_opaque.MI_Bldg_glass_opaque"),
    ("fabric", M("AwningRed")),
    ("accent", fg("Paint", "PaintedMetal_White")),
    ("dark", fg("Paint", "PaintedStone_charcoal")),
    ("roof", fg("Paint", "PaintedMetal_Green")),
]
WALL, TRIM, METAL, GLASS, FABRIC, ACCENT, DARK, ROOF = range(8)


def opts(mid):
    o = unreal.GeometryScriptPrimitiveOptions()
    o.material_id = mid
    return o


def box(m, mid, x0, x1, y0, y1, z0, z1, roll=0.0, pitch=0.0, yaw=0.0):
    t = unreal.Transform(location=[(x0 + x1) / 2, (y0 + y1) / 2, z0], rotation=unreal.Rotator(roll=roll, pitch=pitch, yaw=yaw), scale=[1, 1, 1])
    GS.append_box(m, opts(mid), t, x1 - x0, y1 - y0, z1 - z0, 0, 0, 0, unreal.GeometryScriptPrimitiveOriginMode.BASE)


def slab(m, mid, x0, x1, ya, za, yb, zb, t):
    """A plank of thickness t from (ya, za) to (yb, zb) in the Y-Z plane, running x0..x1 (a sloped awning, a roof plane)."""
    L = math.hypot(yb - ya, zb - za)
    ang = math.degrees(math.atan2(zb - za, yb - ya))
    # a box Y-long, rolled about X: positive roll lifts +Y (checked in the log below)
    t_ = unreal.Transform(location=[(x0 + x1) / 2, (ya + yb) / 2, (za + zb) / 2 - t / 2], rotation=unreal.Rotator(roll=ROLL_SIGN * ang, pitch=0, yaw=0), scale=[1, 1, 1])
    GS.append_box(m, opts(mid), t_, x1 - x0, L, t, 0, 0, 0, unreal.GeometryScriptPrimitiveOriginMode.BASE)


def pyramid(m, mid, cx, cy, z0, half_x, half_y, h):
    """A four-sided pyramid (hip roof) over a rectangle, built from a 4-step cone scaled to the rectangle."""
    # (a transform scales before it turns: a 45-degree cone scaled there is a rhombus, so turn, then scale)
    r = math.sqrt(2) * 50.0
    tmp = unreal.DynamicMesh()
    GS.append_cone(tmp, opts(mid), unreal.Transform(rotation=unreal.Rotator(roll=0, pitch=0, yaw=45)), r, 0.0, h, 4, 0, True, unreal.GeometryScriptPrimitiveOriginMode.BASE)
    tmp.scale_mesh(unreal.Vector(half_x / 50.0, half_y / 50.0, 1.0), unreal.Vector(0, 0, 0))
    m.append_mesh(tmp, unreal.Transform(location=[cx, cy, z0]))


def cyl(m, mid, cx, cy, z0, r, h, steps=12):
    t = unreal.Transform(location=[cx, cy, z0], rotation=unreal.Rotator(roll=0, pitch=0, yaw=0), scale=[1, 1, 1])
    GS.append_cylinder(m, opts(mid), t, r, h, steps, 0, True, unreal.GeometryScriptPrimitiveOriginMode.BASE)


# which way a positive roll tilts +Y (Unreal's rotator handedness, read once, not assumed)
_q = unreal.Rotator(roll=10, pitch=0, yaw=0).quaternion()
ROLL_SIGN = 1.0 if _q.rotate_vector(unreal.Vector(0, 1, 0)).z > 0 else -1.0
unreal.log("KIT roll sign %+.0f" % ROLL_SIGN)


def save(m, folder, name, uv=100.0, slots=None):
    # box-projected UVs, one tile per uv cm (the City Sample building materials tile their texture per metre)
    UV.set_mesh_u_vs_from_box_projection(m, 0, unreal.Transform(scale=[uv, uv, uv]), unreal.GeometryScriptMeshSelection())
    o = unreal.GeometryScriptCreateNewStaticMeshAssetOptions()
    o.enable_recompute_normals = True
    o.enable_recompute_tangents = True
    o.enable_nanite = True
    o.enable_collision = False
    path = "%s/%s" % (folder, name)
    if EAL.does_asset_exist(path):
        EAL.delete_asset(path)
    sm, _ = unreal.GeometryScript_NewAssetUtils.create_new_static_mesh_asset_from_mesh(m, path, o)
    use = dict(SLOTS)
    if slots:
        use.update(slots)
    sm.set_editor_property("static_materials", [unreal.StaticMaterial(material_interface=unreal.load_asset(use[n]), material_slot_name=n) for n, _ in SLOTS])
    ns = sm.get_editor_property("nanite_settings")      # the create option does not take: set on the asset
    ns.enabled = True
    sm.set_editor_property("nanite_settings", ns)
    EAL.save_loaded_asset(sm)


def mesh():
    return unreal.DynamicMesh()


# ================================================================== shared kit
# SM_K_Unit: a 100 cm cube on its base (X, Y centred), slot "wall"; scaled freely
# with a flat material it makes kerbs, canopy decks, fascias, curbs, signs
m = mesh(); box(m, WALL, -50, 50, -50, 50, 0, 100); save(m, KIT, "SM_K_Unit", uv=100.0)
# SM_K_Column: a 30 cm square steel column 100 tall (scaled in Z), base plate
m = mesh(); box(m, ACCENT, -15, 15, -15, 15, 0, 100); save(m, KIT, "SM_K_Column")
# SM_K_Pyramid: a hip roof over a 100 x 100 base, 100 tall, slot "roof" (scale to the footprint and the rise)
m = mesh(); pyramid(m, ROOF, 0, 0, 0, 50, 50, 100); save(m, KIT, "SM_K_Pyramid")
# SM_K_ManDoor: a hollow-metal service door in its frame, a stoop and a wall pack light over it
m = mesh()
box(m, METAL, -55, 55, 0, 6, 0, 225)          # frame
box(m, ACCENT, -48, 48, 4, 8, 2, 216)         # the door leaf (painted)
box(m, METAL, 30, 40, 8, 12, 95, 105)         # lever
box(m, TRIM, -75, 75, 0, 110, 0, 15)          # concrete stoop
box(m, DARK, -14, 14, 0, 18, 250, 270)        # wall pack
save(m, KIT, "SM_K_ManDoor", slots={"accent": M("EifsGrey")})
# SM_K_DockDoor: a truck dock, 400 wide: an insulated sectional door at dock
# height (bottom 120 cm up: the truck bed), a dock shelter round it, black bumpers,
# the leveller lip, a dock light on an arm
m = mesh()
box(m, DARK, -190, -150, 0, 60, 100, 440)     # shelter sides
box(m, DARK, 150, 190, 0, 60, 100, 440)
box(m, DARK, -190, 190, 0, 60, 420, 470)      # shelter head
box(m, ACCENT, -150, 150, 0, 4, 120, 420)     # the door
for z in range(150, 420, 61):                 # panel joints
    box(m, METAL, -150, 150, 3, 6, z, z + 3)
box(m, DARK, -130, -100, 0, 14, 75, 115)      # bumpers
box(m, DARK, 100, 130, 0, 14, 75, 115)
box(m, TRIM, -200, 200, 0, 8, 0, 120)         # the dock face
box(m, METAL, -150, 150, 0, 30, 116, 121)     # leveller lip
box(m, DARK, 205, 215, 0, 80, 330, 336)       # dock light arm
save(m, KIT, "SM_K_DockDoor", slots={"accent": fg("Paint", "PaintedMetal_White")})
# SM_K_Trailer: a 53 ft dry van (1,615 x 260 x 410 cm), its rear doors at X=0 (backed to the dock), nose at X=1615
m = mesh()
box(m, ACCENT, 0, 1615, -130, 130, 125, 410)  # the box
box(m, METAL, -2, 2, -128, 128, 128, 405)     # rear door frame
box(m, DARK, 0, 1615, -110, 110, 100, 125)    # the frame rails
for x in (90, 220):                           # tandem axles at the rear, two tyres a side
    for y in (-115, 115):
        box(m, DARK, x - 50, x + 50, y - 15, y + 15, 0, 100)
box(m, METAL, 1150, 1170, -100, 100, 0, 110)  # landing gear
box(m, METAL, 0, 1615, -131, -129, 128, 135)  # rub rail
box(m, METAL, 0, 1615, 129, 131, 128, 135)
save(m, KIT, "SM_K_Trailer", slots={"accent": fg("Paint", "PaintedMetal_White")})
# SM_K_Condenser: a ground-mounted split-system condenser on its pad (a shop's AC out back)
m = mesh()
box(m, TRIM, -60, 60, -55, 55, 0, 10)
box(m, ACCENT, -45, 45, -45, 45, 10, 100)
cyl(m, DARK, 0, 0, 100, 35, 3)
save(m, KIT, "SM_K_Condenser", slots={"accent": fg("Paint", "PaintedStone_Beige")})
# SM_K_Bollard: a 15 cm steel pipe bollard, painted yellow
m = mesh(); cyl(m, ACCENT, 0, 0, 0, 8, 100, 10); save(m, KIT, "SM_K_Bollard", slots={"accent": M("BrandYellow")})

# ================================================================== retail kit
# SM_RK_Storefront: one 600 cm bay of aluminium storefront: kick plate, three
# lites with a transom over, a pair of doors in the right two lites
m = mesh()
W = 600
box(m, METAL, -W / 2, W / 2, -12, 2, 0, 35)            # kick plate / sill
box(m, METAL, -W / 2, W / 2, -12, 2, 268, 278)         # transom bar
box(m, METAL, -W / 2, W / 2, -12, 2, 330, 342)         # head
for x in (-300, -100, 100, 300):                       # mullions
    box(m, METAL, x - 4, x + 4, -12, 4, 0, 342)
box(m, GLASS, -W / 2, W / 2, -10, -6, 35, 330)         # the glass
# the doors (a pair, 90 cm leaves) in the middle lite, with push bars and a stile frame
for x0 in (-90, 0):
    box(m, METAL, x0, x0 + 90, -6, 0, 0, 8)
    box(m, METAL, x0, x0 + 6, -6, 0, 0, 268)
    box(m, METAL, x0 + 84, x0 + 90, -6, 0, 0, 268)
    box(m, METAL, x0, x0 + 90, -6, 0, 262, 268)
    box(m, METAL, x0 + 10, x0 + 80, -2, 3, 100, 106)   # push bar
box(m, DARK, -W / 2, W / 2, -40, -34, 0, 330)          # the shop behind the glass (dark)
save(m, RET, "SM_RK_Storefront")

# SM_RK_Pier: a 70 cm masonry pier standing 30 proud of the face, 650 tall (scaled in Z), a precast base and cap
m = mesh()
box(m, WALL, -35, 35, -5, 30, 40, 630)
box(m, TRIM, -38, 38, -5, 33, 0, 40)
box(m, TRIM, -42, 42, -5, 38, 630, 650)
save(m, RET, "SM_RK_Pier", slots={"wall": fg("Brick", "BrickOffset_Yellow")})

# SM_RK_Awning: a 600 cm fixed fabric awning: a sloped face from the wall (Z 345)
# out 130 cm and down 70, a 25 cm valance, closed ends
m = mesh()
slab(m, FABRIC, -W / 2, W / 2, 0, 345, 130, 275, 4)
box(m, FABRIC, -W / 2, W / 2, 126, 131, 248, 277)       # valance
for x in (-W / 2, W / 2 - 4):                            # the ends: stacked steps under the slope
    for k in range(7):
        y = 130 * (k + 0.5) / 7.0
        ztop = 345 - 70 * (y / 130.0)
        box(m, FABRIC, x, x + 4, y - 9.3, y + 9.3, 265, ztop)
save(m, RET, "SM_RK_Awning")
# SM_RK_Canopy: a flat metal canopy (the newer centres' eyebrow), 600 long, 150 out, on two tie rods
m = mesh()
box(m, METAL, -W / 2, W / 2, 0, 150, 330, 352)
box(m, METAL, -W / 2, W / 2, 140, 150, 322, 352)
for x in (-W / 2 + 40, W / 2 - 40):
    slab(m, METAL, x - 2, x + 2, 0, 470, 140, 352, 3)
save(m, RET, "SM_RK_Canopy")

# SM_RK_Raceway: a channel-letter raceway: a 100 x 100 sign field (scaled to the sign), 12 deep, slot "accent"
m = mesh(); box(m, ACCENT, -50, 50, 0, 12, 0, 100); save(m, RET, "SM_RK_Raceway", slots={"accent": M("Bronze")})
# SM_RK_SignBox: a backlit cabinet sign 100 x 100 (scaled), a dark returns frame and a glowing face
m = mesh()
box(m, DARK, -50, 50, 0, 20, 0, 100)
box(m, ACCENT, -46, 46, 20, 22, 4, 96)
save(m, RET, "SM_RK_SignBox", slots={"accent": "%s/MI_RK_GlowWhite.MI_RK_GlowWhite" % MATS})

# SM_RK_Coping: a parapet's precast coping, 100 long (scaled in X), 45 deep, 18 tall, overhanging the face 10
m = mesh(); box(m, TRIM, -50, 50, -35, 10, 0, 18); save(m, RET, "SM_RK_Coping")
# SM_RK_Cornice: a stepped cornice 100 long: 3 tiers projecting 15/30/45
m = mesh()
box(m, TRIM, -50, 50, -30, 15, 0, 25)
box(m, TRIM, -50, 50, -30, 30, 25, 45)
box(m, TRIM, -50, 50, -30, 45, 45, 70)
save(m, RET, "SM_RK_Cornice")

# SM_RK_Tower: the entry tower: 900 wide, 250 proud of the face and 300 back
# into the building, walls to 1050, a cornice, a glazed entry and clerestory
# between corner piers, a hip roof (slot "roof") rising 380
m = mesh()
TW, TY0, TY1, TH = 900, -300, 250, 1050
box(m, WALL, -TW / 2, -TW / 2 + 140, TY0, TY1, 0, TH)     # corner piers
box(m, WALL, TW / 2 - 140, TW / 2, TY0, TY1, 0, TH)
box(m, WALL, -TW / 2 + 140, TW / 2 - 140, TY1 - 60, TY1, 760, TH)   # the head over the opening (sign field)
box(m, WALL, -TW / 2, TW / 2, TY0, TY1 - 60, 400, TH)    # the tower's mass behind
box(m, GLASS, -TW / 2 + 140, TW / 2 - 140, TY1 - 70, TY1 - 64, 0, 760)
for x in (-200, 0, 200):
    box(m, METAL, x - 5, x + 5, TY1 - 72, TY1 - 60, 0, 760)
box(m, METAL, -TW / 2 + 140, TW / 2 - 140, TY1 - 72, TY1 - 60, 330, 345)
box(m, TRIM, -TW / 2 - 20, TW / 2 + 20, TY0 - 20, TY1 + 20, TH, TH + 40)   # cornice
box(m, TRIM, -TW / 2 - 35, TW / 2 + 35, TY0 - 35, TY1 + 35, TH + 40, TH + 60)
pyramid(m, ROOF, 0, (TY0 + TY1) / 2, TH + 60, TW / 2 + 30, (TY1 - TY0) / 2 + 30, 380)
box(m, TRIM, -TW / 2, TW / 2, TY1 - 2, TY1 + 8, 0, 40)  # the base
save(m, RET, "SM_RK_Tower")
# SM_RK_TowerFlat: the same mass with a flat, deep cornice instead of the roof (a 1990s-2000s centre)
m = mesh()
box(m, WALL, -TW / 2, -TW / 2 + 140, TY0, TY1, 0, TH)
box(m, WALL, TW / 2 - 140, TW / 2, TY0, TY1, 0, TH)
box(m, WALL, -TW / 2 + 140, TW / 2 - 140, TY1 - 60, TY1, 760, TH)
box(m, WALL, -TW / 2, TW / 2, TY0, TY1 - 60, 400, TH)
box(m, GLASS, -TW / 2 + 140, TW / 2 - 140, TY1 - 70, TY1 - 64, 0, 760)
for x in (-200, 0, 200):
    box(m, METAL, x - 5, x + 5, TY1 - 72, TY1 - 60, 0, 760)
box(m, METAL, -TW / 2 + 140, TW / 2 - 140, TY1 - 72, TY1 - 60, 330, 345)
box(m, TRIM, -TW / 2 - 25, TW / 2 + 25, TY0 - 25, TY1 + 25, TH, TH + 30)
box(m, TRIM, -TW / 2 - 50, TW / 2 + 50, TY0 - 50, TY1 + 50, TH + 30, TH + 70)
save(m, RET, "SM_RK_TowerFlat")

# SM_RK_Entry: a grocery or big box's entrance: a portal 1,800 wide standing
# 300 proud, 1,250 tall (scaled in Z with the box). The sign field across its
# head (900 up); under it a tall glazed band (the store's lit front, 560-900);
# a flat canopy over a glazed vestibule with two pairs of sliding doors; planters
# either side
m = mesh()
EW, EP, EH = 1800, 300, 1250
box(m, WALL, -EW / 2, -EW / 2 + 180, -60, EP, 0, EH)       # portal legs
box(m, WALL, EW / 2 - 180, EW / 2, -60, EP, 0, EH)
box(m, WALL, -EW / 2, EW / 2, EP - 120, EP, 900, EH)        # the head (sign field)
box(m, WALL, -EW / 2, EW / 2, -60, EP - 120, 900, EH)
box(m, TRIM, -EW / 2 - 25, EW / 2 + 25, -60, EP + 25, EH, EH + 45)   # cap
box(m, TRIM, -EW / 2 + 180, EW / 2 - 180, EP - 125, EP - 5, 880, 900)  # the head's soffit band
VX = EW / 2 - 180
# the tall glazed band over the vestibule: mullions every 240, a transom
box(m, GLASS, -VX, VX, EP - 130, EP - 124, 500, 880)
for x in range(int(-VX), int(VX) + 1, 240):
    box(m, METAL, x - 5, x + 5, EP - 134, EP - 118, 500, 880)
box(m, METAL, -VX, VX, EP - 134, EP - 118, 690, 700)
# the canopy over the doors: a deck 200 out past the vestibule, its fascia
box(m, METAL, -VX - 40, VX + 40, -60, EP + 200, 470, 500)
box(m, ACCENT, -VX - 40, VX + 40, EP + 190, EP + 205, 455, 505)
# the vestibule: glass and frame, 450 tall, two openings of sliding leaves
box(m, GLASS, -VX, VX, EP - 46, EP - 40, 0, 450)
for x in (-VX, -VX / 2 - 140, -VX / 2 + 140, VX / 2 - 140, VX / 2 + 140, VX):
    box(m, METAL, x - 8, x + 8, EP - 54, EP - 30, 0, 460)   # jambs and corner posts
for x in (-VX * 0.75, VX * 0.75):
    box(m, METAL, x - 5, x + 5, EP - 52, EP - 34, 0, 460)
box(m, METAL, -VX, VX, EP - 56, EP - 28, 270, 300)          # the door header and transom bar
box(m, METAL, -VX, VX, EP - 56, EP - 28, 440, 460)
for xc in (-VX / 2, VX / 2):
    for side in (-1, 1):                                    # sliding leaves: a frame round each, a seam
        x0, x1 = (xc - 135, xc - 2) if side < 0 else (xc + 2, xc + 135)
        box(m, METAL, x0, x1, EP - 36, EP - 30, 0, 10)
        box(m, METAL, x0, x0 + 8, EP - 36, EP - 30, 0, 270)
        box(m, METAL, x1 - 8, x1, EP - 36, EP - 30, 0, 270)
    box(m, DARK, xc - 150, xc + 150, EP - 40, EP + 120, 0, 2)  # floor mat
for x in (-VX - 20, VX - 140):                              # planters
    box(m, TRIM, x, x + 160, EP + 20, EP + 120, 0, 90)
save(m, RET, "SM_RK_Entry")

# SM_RK_Pylon: a centre's pylon sign, 300 wide, 900 tall (scaled), a masonry
# base, a rendered column carrying the tenant panels, a cap, the centre's name panel at the top
m = mesh()
box(m, TRIM, -170, 170, -60, 60, 0, 90)                     # base
box(m, WALL, -150, 150, -45, 45, 90, 900)                   # column
box(m, TRIM, -170, 170, -60, 60, 900, 930)                  # cap
box(m, WALL, -60, 60, -45, 45, 930, 990)                    # crest
box(m, TRIM, -75, 75, -55, 55, 990, 1005)
save(m, RET, "SM_RK_Pylon", slots={"wall": M("EifsTan")})

# SM_RK_PumpIsland: a fuel island: kerbed concrete 480 x 120, two dispensers, bollards at the ends
m = mesh()
box(m, TRIM, -240, 240, -60, 60, 0, 15)
for x in (-110, 110):
    box(m, ACCENT, x - 45, x + 45, -30, 30, 15, 200)        # the dispenser
    box(m, DARK, x - 40, x + 40, -31, 31, 120, 170)         # its screen band
for x in (-225, 225):
    cyl(m, METAL, x, 0, 15, 8, 90, 10)
save(m, RET, "SM_RK_PumpIsland", slots={"accent": fg("Paint", "PaintedMetal_White"), "metal": M("BrandYellow")})

# SM_RK_CartCorral: a cart corral, 400 x 150, pipe rails 100 tall, carts nested inside
m = mesh()
for y in (-75, 75):
    box(m, METAL, -200, 200, y - 3, y + 3, 95, 101)
    box(m, METAL, -200, 200, y - 3, y + 3, 45, 50)
for x in (-200, 200):
    for y in (-75, 75):
        box(m, METAL, x - 3, x + 3, y - 3, y + 3, 0, 101)
box(m, METAL, 197, 203, -75, 75, 95, 101)
box(m, ACCENT, 200, 203, -60, 60, 105, 150)                 # the "return carts here" plate
for k in range(5):                                          # nested carts
    x = -170 + k * 55
    box(m, DARK, x, x + 80, -30, 30, 30, 95)
save(m, RET, "SM_RK_CartCorral", slots={"metal": fg("Metal", "Metal_Brushed"), "accent": M("BrandBlue"), "dark": fg("Metal", "Metal_BrushedWorn")})

# SM_RK_MenuBoard: a drive-through menu board with its speaker post and a little canopy
m = mesh()
box(m, DARK, -110, 110, -15, 15, 60, 240)
box(m, ACCENT, -100, 100, 15, 17, 70, 230)
box(m, METAL, -10, 10, -10, 10, 0, 60)
box(m, METAL, -130, 130, -40, 40, 240, 255)
save(m, RET, "SM_RK_MenuBoard", slots={"accent": "%s/MI_RK_GlowWhite.MI_RK_GlowWhite" % MATS})

unreal.log("KIT built")
