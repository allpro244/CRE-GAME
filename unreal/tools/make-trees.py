# LEAFY STREET TREES. City Sample's trees are all winter trees (bark, no
# leaves), which is right for December and why the city read grey from April to
# November. These are the same streets in leaf: a trunk and a canopy built from
# a cluster of overlapping spheres (lumpy, the way a crown reads from a roof or
# a drone), in three street-tree habits:
#   SM_LeafTree_Round   a maple or a linden: a round crown, ~9 m wide on 12 m
#   SM_LeafTree_Upright a pear or a hornbeam: narrow and tall, ~6 m on 12 m
#   SM_LeafTree_Spread  a London plane or a honey locust: wide, ~11 m on 13 m
# Sizes are mature street trees in a mid-Atlantic city (a 3-4 m clear trunk
# over the sidewalk, the crown above the trucks).
# M_BW_Leaves colours them: noise-patched greens, lit from above, "Season"
# tinting spring's fresh yellow-green, and "Autumn" (0..1) turning them to
# yellows and reds, each tree at its own pace (PerInstanceRandom).
# CityBuilder::SetSeasonGrass shows these April to November and the bare
# City Sample trees December to March.
#
#   UnrealEditor-Cmd.exe <project> -run=pythonscript -script="<this>"
import math
import random
import unreal

GS = unreal.GeometryScript_Primitives
UV = unreal.GeometryScript_UVs
lib = unreal.MaterialEditingLibrary
tools = unreal.AssetToolsHelpers.get_asset_tools()
ROOT = "/Game/BW/Trees"
BARK = "/Game/Prop/Kit_Tree_Alder/Material/Bark_Mat.Bark_Mat"

# --- the leaf material ---
MPATH, MNAME = "/Game/BW/Materials", "M_BW_Leaves"
if unreal.EditorAssetLibrary.does_asset_exist(f"{MPATH}/{MNAME}"):
    unreal.EditorAssetLibrary.delete_asset(f"{MPATH}/{MNAME}")
mat = tools.create_asset(MNAME, MPATH, unreal.Material, unreal.MaterialFactoryNew())
mat.set_editor_property("used_with_instanced_static_meshes", True)
mat.set_editor_property("used_with_nanite", True)


def node(cls, x, y):
    return lib.create_material_expression(mat, cls, x, y)


def const(v, x, y):
    c = node(unreal.MaterialExpressionConstant, x, y)
    c.set_editor_property("r", v)
    return c


def vparam(name, col, x, y):
    p = node(unreal.MaterialExpressionVectorParameter, x, y)
    p.set_editor_property("parameter_name", name)
    p.set_editor_property("default_value", unreal.LinearColor(*col, 1))
    return p


def op(cls, a, b, x, y, pa="A", pb="B"):
    n = node(cls, x, y)
    lib.connect_material_expressions(a, "", n, pa)
    lib.connect_material_expressions(b, "", n, pb)
    return n


def lerp(a, b, t, x, y):
    n = node(unreal.MaterialExpressionLinearInterpolate, x, y)
    lib.connect_material_expressions(a, "", n, "A")
    lib.connect_material_expressions(b, "", n, "B")
    lib.connect_material_expressions(t, "", n, "Alpha")
    return n


wp = node(unreal.MaterialExpressionWorldPosition, -1800, 0)


def noise(scale, x, y, levels=3):
    n = node(unreal.MaterialExpressionNoise, x, y)
    n.set_editor_property("scale", scale)
    n.set_editor_property("levels", levels)
    n.set_editor_property("output_min", 0.0)
    n.set_editor_property("output_max", 1.0)
    n.set_editor_property("turbulence", True)
    lib.connect_material_expressions(wp, "", n, "Position")
    return n


clump = noise(0.006, -1500, -300)          # leaf clumps, a metre or two
# (a crown in full sun is a darker, less saturated green than a lawn; the
# first cut was a lawn's green and read as broccoli up close)
fleck = noise(0.05, -1500, -100, 2)        # sparkle of individual leaves
rnd = node(unreal.MaterialExpressionPerInstanceRandom, -1500, 150)

dark = vparam("LeafDark", (0.024, 0.044, 0.014), -1200, -500)
light = vparam("LeafLight", (0.062, 0.100, 0.028), -1200, -380)
green = lerp(dark, light, clump, -950, -450)
# trees differ: one street tree a touch bluer, the next a touch yellower
tone = lerp(vparam("ToneA", (0.92, 1.0, 1.05), -1200, -260), vparam("ToneB", (1.12, 1.04, 0.85), -1200, -140), rnd, -950, -220)
green = op(unreal.MaterialExpressionMultiply, green, tone, -750, -350)

# autumn: yellows to reds, by tree
yellow = vparam("AutumnA", (0.34, 0.21, 0.025), -1200, 0)
red = vparam("AutumnB", (0.28, 0.06, 0.025), -1200, 120)
fall = lerp(yellow, red, rnd, -950, 50)
fall = op(unreal.MaterialExpressionMultiply, fall, lerp(const(0.7, -1100, 260), const(1.1, -1100, 320), clump, -950, 260), -750, 100)
autumn = node(unreal.MaterialExpressionScalarParameter, -1200, 420)
autumn.set_editor_property("parameter_name", "Autumn")
autumn.set_editor_property("default_value", 0.0)
# each tree turns at its own pace: alpha = saturate(Autumn * 1.6 - rnd * 0.6)
a1 = op(unreal.MaterialExpressionMultiply, autumn, const(1.6, -1100, 500), -950, 420)
a2 = op(unreal.MaterialExpressionMultiply, rnd, const(0.6, -1100, 580), -950, 540)
a3 = op(unreal.MaterialExpressionSubtract, a1, a2, -800, 460)
sat = node(unreal.MaterialExpressionSaturate, -650, 460)
lib.connect_material_expressions(a3, "", sat, "")
col = lerp(green, fall, sat, -550, -100)

season = vparam("Season", (1, 1, 1), -550, 100)
col = op(unreal.MaterialExpressionMultiply, col, season, -400, -50)
# sparkle, and the crown lit from above: its underside in its own shade
sp = lerp(const(0.85, -700, 200), const(1.12, -700, 260), fleck, -550, 220)
nrm = node(unreal.MaterialExpressionVertexNormalWS, -900, 650)
nz = node(unreal.MaterialExpressionComponentMask, -750, 650)
nz.set_editor_property("r", False); nz.set_editor_property("g", False); nz.set_editor_property("b", True)
lib.connect_material_expressions(nrm, "", nz, "")
top = lerp(const(0.55, -650, 760), const(1.15, -650, 820), op(unreal.MaterialExpressionAdd, op(unreal.MaterialExpressionMultiply, nz, const(0.5, -700, 900), -600, 880), const(0.5, -700, 960), -500, 900), -400, 760)
lit = op(unreal.MaterialExpressionMultiply, sp, top, -300, 400)
col = op(unreal.MaterialExpressionMultiply, col, lit, -200, 0)
lib.connect_material_property(col, "", unreal.MaterialProperty.MP_BASE_COLOR)
lib.connect_material_property(const(0.8, -200, 200), "", unreal.MaterialProperty.MP_ROUGHNESS)
lib.connect_material_property(const(0.3, -200, 280), "", unreal.MaterialProperty.MP_SPECULAR)
lib.recompile_material(mat)
unreal.EditorAssetLibrary.save_asset(f"{MPATH}/{MNAME}")
LEAVES = f"{MPATH}/{MNAME}.{MNAME}"
unreal.log("TREES leaf material made")


# --- the meshes ---
def sphere(m, mid, x, y, z, r, sx=1.0, sy=1.0, sz=1.0):
    o = unreal.GeometryScriptPrimitiveOptions()
    o.material_id = mid
    t = unreal.Transform(location=[x, y, z], rotation=[0, 0, 0], scale=[sx, sy, sz])
    GS.append_sphere_lat_long(m, o, t, r, 8, 12, unreal.GeometryScriptPrimitiveOriginMode.CENTER)


def trunk(m, h, r):
    o = unreal.GeometryScriptPrimitiveOptions()
    o.material_id = 0
    GS.append_cylinder(m, o, unreal.Transform(), r, h, 8, 1, True, unreal.GeometryScriptPrimitiveOriginMode.BASE)
    # three main limbs into the crown
    for k in range(3):
        a = k * 2.1
        GS.append_cylinder(m, o, unreal.Transform(location=[0, 0, h - 40], rotation=[math.degrees(math.cos(a)) * 0.45, math.degrees(math.sin(a)) * 0.45, 0], scale=[1, 1, 1]),
                           r * 0.6, 260, 6, 1, True, unreal.GeometryScriptPrimitiveOriginMode.BASE)


def crown(m, seed, cz, rx, rz, n, rmin, rmax):
    """A crown centred at height cz, an ellipsoid rx wide (radius) and rz tall,
    as n lumps on its shell around a solid core."""
    rnd = random.Random(seed)
    sphere(m, 1, 0, 0, cz, 100, rx * 0.82 / 100, rx * 0.82 / 100, rz * 0.82 / 100)
    for i in range(n):
        # even-ish over the upper and side shell (a crown's underside is open)
        u = rnd.uniform(-0.45, 1.0)
        th = rnd.uniform(0, 2 * math.pi)
        s = math.sqrt(max(0.0, 1 - u * u))
        r = rnd.uniform(rmin, rmax)
        sphere(m, 1, rx * 0.72 * s * math.cos(th), rx * 0.72 * s * math.sin(th), cz + rz * 0.72 * u, r)


def save(m, name):
    UV.set_mesh_u_vs_from_box_projection(m, 0, unreal.Transform(scale=[1.0, 1.0, 1.0]), unreal.GeometryScriptMeshSelection())
    o = unreal.GeometryScriptCreateNewStaticMeshAssetOptions()
    o.enable_recompute_normals = False
    o.enable_recompute_tangents = True
    o.enable_nanite = True
    o.enable_collision = False
    path = "%s/%s" % (ROOT, name)
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        unreal.EditorAssetLibrary.delete_asset(path)
    sm, _ = unreal.GeometryScript_NewAssetUtils.create_new_static_mesh_asset_from_mesh(m, path, o)
    sm.set_editor_property("static_materials", [unreal.StaticMaterial(material_interface=unreal.load_asset(BARK), material_slot_name="bark"),
                                                 unreal.StaticMaterial(material_interface=unreal.load_asset(LEAVES), material_slot_name="leaves")])
    ns = sm.get_editor_property("nanite_settings")      # the create option does not take: set on the asset
    ns.enabled = True
    sm.set_editor_property("nanite_settings", ns)
    unreal.EditorAssetLibrary.save_loaded_asset(sm)


m = unreal.DynamicMesh()           # maple / linden: round, 9 m wide, 12 m tall
trunk(m, 380, 16)
crown(m, 1, 780, 450, 400, 22, 150, 230)
save(m, "SM_LeafTree_Round")

m = unreal.DynamicMesh()           # pear / hornbeam: upright oval, 6 m wide, 12 m tall
trunk(m, 320, 13)
crown(m, 2, 760, 300, 460, 20, 110, 170)
save(m, "SM_LeafTree_Upright")

m = unreal.DynamicMesh()           # London plane / honey locust: wide and flat-topped, 11 m by 13 m
trunk(m, 420, 19)
crown(m, 3, 900, 560, 340, 26, 160, 240)
save(m, "SM_LeafTree_Spread")
unreal.log("TREES built")
