# Shared helpers for the building kit scripts (make-homes.py; make-kit.py keeps
# its own copy of the first few). Conventions, as RetailBuilder/HouseBuilder read them:
#   - centimetres, Z up from the ground;
#   - every mesh carries the same eight material slots, by name, so a builder can
#     recolour any piece per instanced component:
#       wall, trim, metal, glass, fabric, accent, dark, roof
#     (a house uses "fabric" for its masonry: chimney, foundation, a brick wainscot)
#   - Nanite on, no collision.
import math
import unreal

GS = unreal.GeometryScript_Primitives
UV = unreal.GeometryScript_UVs
EAL = unreal.EditorAssetLibrary
MEL = unreal.MaterialEditingLibrary
TOOLS = unreal.AssetToolsHelpers.get_asset_tools()
FG = "/Game/Building/Material/MI/%s/ForGym/MI_Bldg_%s_FG.MI_Bldg_%s_FG"
WALL, TRIM, METAL, GLASS, FABRIC, ACCENT, DARK, ROOF = range(8)
SLOT_NAMES = ["wall", "trim", "metal", "glass", "fabric", "accent", "dark", "roof"]
TINT = unreal.Name("Color Tint/Mult(A) M1")


def fg(folder, name):
    return FG % (folder, name, name)


def tinted(folder_out, name, folder, parent, rgb):
    """A colour of a City Sample "ForGym" instance (they take a tint multiplier), at <folder_out>/<name>; returns its path."""
    base = unreal.load_asset(fg(folder, parent))
    path = "%s/%s" % (folder_out, name)
    if not base:
        unreal.log_warning("KIT missing parent %s" % parent)
        return path
    mi = unreal.load_asset(path) if EAL.does_asset_exist(path) else TOOLS.create_asset(name, folder_out, unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
    mi.set_editor_property("parent", base)
    cur = MEL.get_material_instance_vector_parameter_value(base, TINT)
    MEL.set_material_instance_vector_parameter_value(mi, TINT, unreal.LinearColor(cur.r * rgb[0], cur.g * rgb[1], cur.b * rgb[2], cur.a))
    MEL.update_material_instance(mi)
    EAL.save_loaded_asset(mi)
    return "%s.%s" % (path, name)


def opts(mid):
    o = unreal.GeometryScriptPrimitiveOptions()
    o.material_id = mid
    return o


def box(m, mid, x0, x1, y0, y1, z0, z1):
    x0, x1 = min(x0, x1), max(x0, x1)
    y0, y1 = min(y0, y1), max(y0, y1)
    t = unreal.Transform(location=[(x0 + x1) / 2, (y0 + y1) / 2, z0], rotation=unreal.Rotator(roll=0, pitch=0, yaw=0), scale=[1, 1, 1])
    GS.append_box(m, opts(mid), t, x1 - x0, y1 - y0, z1 - z0, 0, 0, 0, unreal.GeometryScriptPrimitiveOriginMode.BASE)


def poly_solid(m, mid, verts, faces):
    """A solid from convex polygonal faces (lists of vertex indices), each face given its own vertices and laid
    both ways round, so it shows whatever the winding (roof planes and gable ends read from either side)."""
    V, T = [], []
    for f in faces:
        for flip in (False, True):
            base = len(V)
            for i in f:
                V.append(unreal.Vector(*verts[i]))
            n = len(f)
            for k in range(1, n - 1):
                T.append(unreal.IntVector(base, base + k + 1, base + k) if flip else unreal.IntVector(base, base + k, base + k + 1))
    b = unreal.GeometryScriptSimpleMeshBuffers()
    b.set_editor_property("vertices", V)
    b.set_editor_property("triangles", T)
    tmp = unreal.DynamicMesh()
    tmp.append_buffers_to_mesh(b, 0)
    if mid != 0:
        tmp.remap_material_i_ds(0, mid)
    m.append_mesh(tmp, unreal.Transform())


def prism(m, mid, pts, a0, a1, axis="x"):
    """A convex polygon extruded along an axis: pts are (y, z) for axis "x", (x, z) for axis "y"."""
    n = len(pts)
    if axis == "x":
        verts = [(a0, p[0], p[1]) for p in pts] + [(a1, p[0], p[1]) for p in pts]
    else:
        verts = [(p[0], a0, p[1]) for p in pts] + [(p[0], a1, p[1]) for p in pts]
    faces = [list(range(n)), list(range(n, 2 * n))]
    for i in range(n):
        j = (i + 1) % n
        faces.append([i, j, n + j, n + i])
    poly_solid(m, mid, verts, faces)


def gable(m, wall, roof, x0, x1, y0, y1, z, rise, over=40, axis="x", t=14):
    """A gable roof on a rectangle at eave height z: the ridge along `axis`, its gable ends in the wall's material,
    two roof planes overhanging by `over`."""
    if axis == "x":
        a0, a1, b0, b1 = x0, x1, y0, y1
    else:
        a0, a1, b0, b1 = y0, y1, x0, x1
    bm = (b0 + b1) / 2
    half = (b1 - b0) / 2
    s = rise / half
    prism(m, wall, [(b0, z), (b1, z), (bm, z + rise)], a0, a1, axis)
    for side in (-1, 1):
        e = b0 - over if side < 0 else b1 + over
        ze = z - over * s
        prism(m, roof, [(e, ze), (bm, z + rise), (bm, z + rise + t), (e, ze + t)], a0 - over, a1 + over, axis)


def hip(m, mid, x0, x1, y0, y1, z, rise, over=50):
    """A hip roof over a rectangle at eave height z (45-degree hips in plan, a ridge along the longer side)."""
    x0, x1, y0, y1 = x0 - over, x1 + over, y0 - over, y1 + over
    W, D = x1 - x0, y1 - y0
    zr = z + rise
    if W >= D:
        h = D / 2
        a, b = (x0 + h, (y0 + y1) / 2, zr), (x1 - h, (y0 + y1) / 2, zr)
    else:
        h = W / 2
        a, b = ((x0 + x1) / 2, y0 + h, zr), ((x0 + x1) / 2, y1 - h, zr)
    c00, c10, c11, c01 = (x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)
    v = [c00, c10, c11, c01, a, b]
    if W >= D:
        faces = [[0, 1, 5, 4], [2, 3, 4, 5], [3, 0, 4], [1, 2, 5], [0, 3, 2, 1]]
    else:
        faces = [[1, 2, 5, 4], [3, 0, 4, 5], [0, 1, 4], [2, 3, 5], [0, 3, 2, 1]]
    poly_solid(m, mid, v, faces)
    # (a thin soffit under the overhang is the bottom face; the roof reads as a solid cap)


def save(m, folder, name, slots, uv=100.0):
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
    sm.set_editor_property("static_materials", [unreal.StaticMaterial(material_interface=unreal.load_asset(slots[n]), material_slot_name=n) for n in SLOT_NAMES])
    ns = sm.get_editor_property("nanite_settings")      # the create option does not take: set on the asset
    ns.enabled = True
    sm.set_editor_property("nanite_settings", ns)
    EAL.save_loaded_asset(sm)
