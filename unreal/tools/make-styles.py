# Build Broadway & Wall's own facade styles from recipes.
#   UnrealEditor-Cmd.exe <project> -run=pythonscript -script="<this> <recipes.json> <Data dir> [KEY ...]"
#
# Each recipe becomes a small kit: a street floor (shopfronts + an entrance), a
# typical floor that repeats up the shaft, an optional top (cornice/parapet/mansard),
# and a corner pier per band, all built from boxes with GeometryScript and the
# City Sample "ForGym" material library. The kit JSON it writes has the same
# band format as the City Sample kits (Data/kit-<KEY>.json), so FacadeBuilder
# dresses a building in a generated style exactly as in a kit one.
#
# Module frame (matches the kits): face on X = 0, body back to X = -50, width
# along Y from -W to 0, Z from 0 to the band height. Material slots:
#   0 wall, 1 trim, 2 glass, 3 base (street floor / rustication), 4 dark (doors, bulkheads, ironwork), 5 accent (awnings),
#   6 roof (a mansard's slates; every style carries the slot, recipe mats.roof)
import json, math, sys, time
import unreal

RUN = time.strftime("v%m%d%H%M%S")

GS = unreal.GeometryScript_Primitives
UV = unreal.GeometryScript_UVs
ROOT = "/Game/BW/Styles"
DEPTH = 50.0
UV_SCALE = [2.0]
BLINDS = [None, 0]   # [variant seed or None, window counter] while building a blind variant   # the box projection size: set per recipe ("uv")
MATS = {
    "glass": "/Game/Building/Material/MI/Glass/MI_Bldg_glass_opaque.MI_Bldg_glass_opaque",
    "dark": "/Game/Building/Material/MI/Paint/ForGym/MI_Bldg_PaintedMetal_Black_FG.MI_Bldg_PaintedMetal_Black_FG",
}


def mat_path(name):
    if name.startswith("/"):
        return name if "." in name else name + "." + name.split("/")[-1]
    # short names: Brick/BrickOffset_Red -> /Game/Building/Material/MI/Brick/ForGym/MI_Bldg_BrickOffset_Red_FG;
    # BW/FibreCementOrange -> /Game/BW/Mats/MI_BW_FibreCementOrange (make-mats.py)
    folder, short = name.split("/")
    if folder == "BW":
        return "/Game/BW/Mats/MI_BW_%s.MI_BW_%s" % (short, short)
    p = "/Game/Building/Material/MI/%s/ForGym/MI_Bldg_%s_FG" % (folder, short)
    return p + "." + p.split("/")[-1]


class Mesh:
    def __init__(self):
        self.m = unreal.DynamicMesh()
        self.zoff = 0.0   # added to every z: the upper storey of a two-storey module
        self.xoff = 0.0   # added to every x: a zone popped out (+) or set back (-)

    def box(self, mid, x0, x1, y0, y1, z0, z1):
        """an axis box between the given planes (cm), material slot mid"""
        if x1 - x0 < 0.1 or y1 - y0 < 0.1 or z1 - z0 < 0.1:
            return
        o = unreal.GeometryScriptPrimitiveOptions()
        o.material_id = mid
        z0 += self.zoff
        x0 += self.xoff
        x1 += self.xoff
        t = unreal.Transform(location=[(x0 + x1) / 2, (y0 + y1) / 2, z0], rotation=[0, 0, 0], scale=[1, 1, 1])
        GS.append_box(self.m, o, t, x1 - x0, y1 - y0, z1 - z0, 0, 0, 0, unreal.GeometryScriptPrimitiveOriginMode.BASE)


# ---------------------------------------------------------------- pieces

def window(M, R, y0, y1, z0, z1):
    """one window opening between y0..y1, z0..z1 cut in the wall plane (the
    caller leaves the gap in the wall): reveal, glass, mullions, sill, head"""
    w = R.get("win", {})
    rec = w.get("recess", 12) * R.get("depth_mult", 1.6)
    fr = w.get("frame", 6)
    # reveal sides and soffit in wall material, so the recess reads as depth
    M.box(0, -rec, 0, y0, y0 + 0.5, z0, z1)
    M.box(0, -rec, 0, y1 - 0.5, y1, z0, z1)
    # glass, set back
    M.box(2, -rec - 4, -rec, y0, y1, z0, z1)
    # A LIVED-IN WINDOW: a blind drawn part way down, or a curtain panel,
    # just behind the frame (the glass is opaque, so this is what reads as
    # the room behind it). Which, and how far, comes from BLINDS: the
    # variant being built and the window's place in it, so the shaft's
    # variants differ only in their blinds and FacadeBuilder mixes them bay
    # by bay and floor by floor.
    if BLINDS[0] is not None and not w.get("ribbon"):
        BLINDS[1] += 1
        h = ((BLINDS[0] * 7919 + BLINDS[1] * 104729) % 1000) / 1000.0
        if h < 0.42:
            # most blinds are part way down; a few all the way
            frac = 0.12 + 0.5 * ((h * 7.3) % 1.0) if h > 0.06 else 0.95
            M.box(8, -rec - 3.5, -rec - 1, y0 + 2, y1 - 2, z1 - (z1 - z0) * frac, z1 - 2)
        # THE WINDOW UNIT: a through-the-window air conditioner on the sill,
        # the texture of every pre-war New York facade (about one window in eight)
        if R.get("ac_units", R.get("group") in ("prewar", "interwar")) and 0.80 < h < 0.93 and y1 - y0 >= 70:
            c = (y0 + y1) / 2
            M.box(8, -rec, 34, c - 33, c + 33, z0 + 2, z0 + 40)
            M.box(4, 30, 35, c - 28, c + 28, z0 + 8, z0 + 34)      # its grille
    elif BLINDS[0] is not None:
        # a ribbon window: blinds in some of its lights, at their own heights
        BLINDS[1] += 1
        n = max(1, w.get("mullions", 1) + 1)
        for k in range(n):
            h = ((BLINDS[0] * 7919 + (BLINDS[1] * 31 + k) * 104729) % 1000) / 1000.0
            if h < 0.3:
                a = y0 + (y1 - y0) * k / n
                b = y0 + (y1 - y0) * (k + 1) / n
                M.box(8, -rec - 3.5, -rec - 1, a + 2, b - 2, z1 - (z1 - z0) * (0.2 + h), z1 - 2)
    # frame
    M.box(1, -rec, -rec + 3, y0, y1, z0, z0 + fr)
    M.box(1, -rec, -rec + 3, y0, y1, z1 - fr, z1)
    M.box(1, -rec, -rec + 3, y0, y0 + fr, z0, z1)
    M.box(1, -rec, -rec + 3, y1 - fr, y1, z0, z1)
    # mullions and transom
    n = w.get("mullions", 1)
    for k in range(1, n + 1):
        y = y0 + (y1 - y0) * k / (n + 1)
        M.box(1, -rec, -rec + 3, y - 2.5, y + 2.5, z0, z1)
    if w.get("transom"):
        z = z1 - (z1 - z0) * 0.28
        M.box(1, -rec, -rec + 3, y0, y1, z - 2.5, z + 2.5)
    # head_trim false leaves the head bare for the caller to dress (a
    # rusticated base sets voussoirs there): no moulding and no architrave
    # head, though an arch keeps its round head
    trim = w.get("head_trim", True)
    # a raised architrave around the opening, and a panel under the sill: the
    # two things that make a masonry window read as made rather than punched
    masonry = is_masonry(R)
    if w.get("surround", masonry):
        sw = w.get("surround_w", 12)
        M.box(1, 0, 4, y0 - sw, y0, z0, z1)
        M.box(1, 0, 4, y1, y1 + sw, z0, z1)
        if trim:
            M.box(1, 0, 4, y0 - sw, y1 + sw, z1, z1 + sw)
    if w.get("apron", masonry):
        ah = w.get("apron_h", 55)
        M.box(1, 0, 3, y0 + 6, y1 - 6, max(4, z0 - 9 - ah), z0 - 9)
        M.box(0, 0, 4.5, y0 + 16, y1 - 16, max(10, z0 - 9 - ah + 10), z0 - 19)
    # sill ledge
    if w.get("sill_ledge", True):
        M.box(1, -rec, 6, y0 - 6, y1 + 6, z0 - 7, z0)
    head = w.get("head", "plain")
    if not trim and head != "arch":
        head = "plain"
    if head == "hood":
        M.box(1, 0, 7, y0 - 10, y1 + 10, z1, z1 + 14)
        M.box(1, 0, 10, y0 - 14, y1 + 14, z1 + 14, z1 + 19)
    elif head == "lintel":
        M.box(1, 0, 3, y0 - 8, y1 + 8, z1, z1 + 22)
    elif head == "keystone":
        M.box(1, 0, 3, y0 - 6, y1 + 6, z1, z1 + 16)
        c = (y0 + y1) / 2
        M.box(1, 0, 6, c - 9, c + 9, z1 - 6, z1 + 26)
    elif head == "arch":
        # a round head: the wall steps in over the top of the opening in eight
        # courses, so the opening reads round, with a trim archivolt line above
        c, r = (y0 + y1) / 2, (y1 - y0) / 2
        zs = z1 - r
        # steps no wider than ~3.5 cm, each at the curve's height across its
        # middle: eight wide courses read as a sawtooth up close
        n = max(8, min(40, int(r / 3.5)))
        for k in range(n):
            a0, a1 = k / float(n), (k + 1) / float(n)
            am = (a0 + a1) / 2
            zc = zs + r * math.sqrt(max(0.0, 1 - am * am))
            M.box(0, -rec - 1, 0, c + r * a0, c + r * a1, zc, z1)
            M.box(0, -rec - 1, 0, c - r * a1, c - r * a0, zc, z1)
            if trim:
                # the archivolt follows the curve, a moulding band on the face
                M.box(1, 0, 4, c + r * a0, c + r * a1, zc, zc + 12)
                M.box(1, 0, 4, c - r * a1, c - r * a0, zc, zc + 12)
        if trim:
            M.box(1, 0, 4, c - 9, c + 9, z1 - 4, z1 + 14)    # keystone at the crown


def is_masonry(R):
    """a punched masonry wall (not a ribbon): its windows get an architrave
    and an apron unless the recipe says otherwise"""
    return not R.get("win", {}).get("ribbon") and R.get("group") in ("prewar", "interwar")


def voussoirs(M, W, H, y0, y1, z1, ov=6, keystone=False, arch=False):
    """a fan of five voussoirs over an opening (y0..y1, head at z1) in a stone
    base, in base material and proud of the courses. Each stone is two boxes,
    the upper one wider and set further out from the centre, so the joints
    splay like a flat arch's; the tops step up to the centre stone, which
    under a keystone head stands prouder and taller as the keystone. Over a
    round head the stones' beds follow the arch down toward its springing.
    ov is how far the fan runs past the opening each side (onto the
    architrave, if there is one)."""
    c, r = (y0 + y1) / 2, (y1 - y0) / 2
    bw = 2 * (r + ov) / 5                                   # a stone's width at its bed
    hc = min(70, max(36, 0.3 * (y1 - y0)), H - 32 - z1)     # the centre stone's rise (under the cap band)
    if hc < 12 or r <= 0:
        return
    sp, j = 0.1 * hc, 1.25                                  # splay per stone, half a joint
    for u in range(-2, 3):
        k = abs(u)
        zb, zt, px = z1, z1 + hc * (1 - 0.2 * k), 5
        if arch and k:
            t = min(1.0, (k - 0.5) * bw / r)
            zb = z1 - r + r * math.sqrt(1 - t * t)
        if keystone and u == 0:
            px, zb, zt = 8, z1 - 6, zt + 10
        zm = (zb + zt) / 2
        for za, zz, s in ((zb, zm, 0.0), (zm, zt, sp)):
            ya = max(-W, c + (u - 0.5) * (bw + s) + j)
            yb = min(0.0, c + (u + 0.5) * (bw + s) - j)
            M.box(3, 0, px, ya, yb, za, zz)


def openings(R, W):
    """the window openings across one bay of width W: list of (y0, y1)"""
    w = R.get("win", {})
    per = w.get("per_bay", 1)
    ww = w.get("w", 120)
    if w.get("ribbon"):
        p = R.get("pier", {}).get("w", 20) / 2
        return [(-W + p, -p)]
    gap = (W - per * ww) / (per + 1)
    out = []
    for k in range(per):
        a = -W + gap + k * (ww + gap)
        out.append((a, a + ww))
    return out


def wall_with_holes(M, mid, W, H, holes, x0=-DEPTH):
    """a slab of wall from y=-W..0, z=0..H with rectangular holes (y0,y1,z0,z1)
    (holes are assumed to share z0/z1, as one row of windows does)"""
    M.box(mid, x0, 0, -W, 0, 0, H) if not holes else None
    if not holes:
        return
    z0 = min(h[2] for h in holes)
    z1 = max(h[3] for h in holes)
    M.box(mid, x0, 0, -W, 0, 0, z0)
    M.box(mid, x0, 0, -W, 0, z1, H)
    ys = sorted((h[0], h[1]) for h in holes)
    y = -W
    for a, b in ys:
        M.box(mid, x0, 0, y, a, z0, z1)
        y = b
    M.box(mid, x0, 0, y, 0, z0, z1)
    # the back of each hole is closed (dark), so nothing shows through
    for a, b, c, d in holes:
        M.box(4, x0, x0 + 2, a, b, c, d)


ORDERS = ("doric", "ionic", "corinthian", "pilaster")


def order(M, kind, W, half, x0, xf, z0, z1, mid=0, tm=1):
    """dress the half piers at a module's two edges (shafts y = -half..0 and
    -W..-W+half, their face at xf) as a classical order, from the foot at z0
    to the top of the capital at z1. A module carries half of each pier and
    its neighbour the other half, so every piece is placed by its distance v
    in from the edge line and mirrored onto both edges: two halves meet as one
    shaft, and anything symmetric about the shaft's axis tiles. The pieces: a
    base (a plinth, then a torus); a capital (an abacus wider than the shaft
    over an echinus; for ionic a volute band wider than the abacus, its
    scrolls hanging at the outer edge; for corinthian a tall bell of two
    flared boxes with leaves on it); and on all but a pilaster an astragal
    under the capital and flutes on the shaft, thin proud fillets whose gaps
    read as the channels. x0 is the back of the base and capital (the wall
    face for a pier; the back of a free column, so they wrap its sides); tm is
    their material, mid the shaft's (the fillets)."""
    if kind not in ORDERS or half <= 0:
        return
    d, h, lim = 2.0 * half, z1 - z0, W / 2.0

    def at(v0, v1, mat, xa, xb, za, zb):
        # a box v0..v1 in from both edges (never past the module's middle)
        v1 = min(v1, lim)
        M.box(mat, xa, xb, -v1, -v0, za, zb)
        M.box(mat, xa, xb, -W + v0, -W + v1, za, zb)

    e = min(10.0, max(3.0, 0.12 * d))                    # how far base and abacus stand past the shaft
    hp = min(0.06 * h, max(8.0, 0.22 * d))               # plinth
    ht = min(0.04 * h, max(5.0, 0.14 * d))               # torus
    df = min(3.0, max(1.2, 0.04 * d))                    # the flutes' fillets' projection
    at(0, half + e, tm, x0, xf + e, z0, z0 + hp)
    at(0, half + 0.6 * e, tm, x0, xf + 0.6 * e, z0 + hp, z0 + hp + ht)
    ha = min(0.035 * h, max(5.0, 0.14 * d))              # abacus
    za = z1 - ha
    at(0, half + e, tm, x0, xf + e, za, z1)
    if kind in ("doric", "pilaster"):
        he = 0.8 * ha
        at(0, half + 0.5 * e, tm, x0, xf + 0.5 * e, za - he, za)                 # echinus
        zc = za - he
    elif kind == "ionic":
        hv = min(0.06 * h, max(8.0, 0.3 * d))
        at(0, half + 1.6 * e, tm, x0, xf + 0.5 * e, za - hv, za)                 # volute band
        at(half - 0.2 * e, half + 1.6 * e, tm, x0, xf + 0.5 * e, za - 1.8 * hv, za - hv)   # its scroll
        at(0, half - 0.2 * e, tm, xf, xf + 0.8 * e, za - 0.8 * hv, za - 0.1 * hv)  # echinus between the scrolls
        zc = za - hv
    else:
        hc = min(0.14 * h, max(16.0, 0.9 * d))
        zm = za - hc / 2
        pb = max(0.3 * e, df + 1)                                                # (clear of the fillets below)
        at(0, half + pb, tm, x0, xf + pb, za - hc, zm)                           # the bell
        pf = max(0.7 * e, pb + 1.5)
        at(0, half + pf, tm, x0, xf + pf, zm, za)                                # its flare under the abacus
        lw = 0.14 * d                                                            # a leaf's half width
        at(0, lw, tm, xf, xf + pb + 2.5, za - hc, zm)                            # leaves: on the axis,
        at(half - lw, half + pb + 2.5, tm, x0, xf + pb + 2.5, za - hc, zm)       # and at the arris
        zc = za - hc
    if kind == "pilaster":
        return
    hs = min(6.0, max(3.0, 0.06 * d))
    at(0, half + 0.2 * e, tm, x0, xf + df + 1.5, zc - hs, zc)                    # astragal
    zf0, zf1 = z0 + hp + ht, zc - hs
    if d < 20 or zf1 - zf0 < 40:
        return
    # nf fillets across the whole shaft, one at each arris; a channel is g
    # fillets wide (a doric's nearly meet, at an arris). Each module lays the
    # half on its side of the axis, splitting a fillet that straddles it.
    nf = max(3, min(5, int(d / 14)))
    g = 4.0 if kind == "doric" else 2.5
    fw = d / (nf + g * (nf - 1))
    for i in range(nf):
        u0 = -half + i * fw * (1 + g)
        if u0 + fw > 0:
            at(max(0.0, u0), u0 + fw, mid, xf, xf + df, zf0, zf1)


def piers(M, R, W, H, mid=0):
    p = R.get("pier", {})
    kind = p.get("order")
    # an order on a pier given no projection stands 8 cm proud, as a pilaster
    proud = p.get("proud") or (8 if kind in ORDERS else 0)
    if not proud:
        return
    half = p.get("w", 30) / 2
    M.box(mid, 0, proud, -half, 0, 0, H)
    M.box(mid, 0, proud, -W, -W + half, 0, H)
    if kind:
        # a full order each storey (superimposed orders: the capital meets the
        # next floor's base; a spandrel band between them reads as the entablature)
        order(M, kind, W, half, 0, proud, 0, H, mid, p.get("order_mat", 1))


def typical(R, W, H, alt=False, M=None):
    M = M or Mesh()
    if alt and R.get("pair_alt", not R.get("win", {}).get("ribbon") and R.get("group") in ("prewar", "interwar") and R.get("win", {}).get("per_bay", 1) == 1 and not R.get("feature")):
        # the alternate bay carries a pair of narrower windows: a facade of
        # bays that alternate one-two-one reads as designed, not punched
        w0 = R["win"]
        R = dict(R, win=dict(w0, per_bay=2, w=min(w0.get("w", 120) * 0.62, (W - 90) / 2)))
    w = R.get("win", {})
    sill = w.get("sill", 90)
    top = min(H - 30, sill + w.get("h", 170))
    holes = [(a, b, sill, top) for a, b in openings(R, W)]
    wall_with_holes(M, 0, W, H, holes)
    for a, b, c, d in holes:
        window(M, R, a, b, c, d)
    piers(M, R, W, H)
    sp = R.get("spandrel")
    if sp:
        # a band at each floor line, proud of the wall (or a recessed panel in a strip facade)
        M.box(sp.get("mat", 1), 0, sp.get("proud", 3), -W, 0, 0, sp.get("h", 18))
    if R.get("belt_every_floor"):
        M.box(1, 0, 5, -W, 0, sill - 10, sill - 4)
    if w.get("caps"):
        # A CURTAIN WALL HAS DEPTH: an aluminium cap on every mullion and at
        # each bay edge, standing proud of the glass, and the band between the
        # ribbons is spandrel glass (opaque, but glass), not painted wall
        cd = w.get("cap_depth", 18)
        for a, b, c, d in holes:
            n = w.get("mullions", 1)
            for k in range(n + 2):
                y = a + (b - a) * k / (n + 1)
                M.box(1, 0, cd, max(-W, y - 3), min(0, y + 3), 0, H)
        M.box(2, 0, 1.5, -W, 0, 0, sill)
        M.box(2, 0, 1.5, -W, 0, top, H)
        M.box(1, 0, cd * 0.6, -W, 0, sill - 4, sill)
    pat = (sp or {}).get("pattern")
    if pat:
        for a, b, c, d in holes:
            spandrel_ornament(M, sp.get("mat", 1), pat, a, b, max(sp.get("h", 18) + 6, 10), c - 12)
    for a, b, c, d in holes:
        window_extras(M, R, a, b, c, d)
    if R.get("panels"):
        panels(M, R, W, H, holes, alt)
    if alt:
        features(M, R, W, H, holes)
    return M


def spandrel_ornament(M, mat, pat, a, b, z0, z1):
    """DECO SPANDRELS: the panel under each window carries the ornament, which
    is most of what makes a facade read as Art Deco at street level (Kahn's
    terra cotta, the Bronx's zigzag brick, Rockefeller Center's cast metal)"""
    if z1 - z0 < 25 or b - a < 40:
        return
    zm, cy, hw = (z0 + z1) / 2, (a + b) / 2, (b - a) / 2
    if pat == "flutes":
        n = max(4, int((b - a) / 14))
        for k in range(n):
            y = a + (b - a) * (k + 0.5) / n
            M.box(mat, 0, 3, y - 2.5, y + 2.5, z0 + 4, z1 - 4)
    elif pat == "chevron":
        n = 5
        for k in range(n):
            w = hw * (1 - k / n)
            z = z0 + 4 + (z1 - z0 - 8) * k / n
            M.box(mat, 0, 3, cy - w, cy - w + 8, z, z + (z1 - z0) / n)
            M.box(mat, 0, 3, cy + w - 8, cy + w, z, z + (z1 - z0) / n)
    elif pat == "diamond":
        n = 6
        for k in range(n):
            f = 1 - abs((k + 0.5) / n * 2 - 1)
            z = z0 + 4 + (z1 - z0 - 8) * k / n
            M.box(mat, 0, 3, cy - hw * 0.8 * f, cy + hw * 0.8 * f, z, z + (z1 - z0 - 8) / n)
    elif pat == "panel":
        M.box(mat, 0, 3, a + 6, b - 6, z0 + 4, z0 + 9)
        M.box(mat, 0, 3, a + 6, b - 6, z1 - 9, z1 - 4)
        M.box(mat, 0, 3, a + 6, a + 11, z0 + 4, z1 - 4)
        M.box(mat, 0, 3, b - 11, b - 6, z0 + 4, z1 - 4)


def window_extras(M, R, a, b, c, d):
    """contemporary window treatments: a pop-out frame round the window, or a
    Juliet rail across its lower half"""
    w = R.get("win", {})
    if w.get("box_frame"):
        # the 2010s window box: a coloured frame 30-50 cm proud round the opening
        fd, ft = w.get("frame_depth", 40), w.get("frame_t", 12)
        mat = 5 if w.get("frame_mat", "accent") == "accent" else 1
        M.box(mat, 0, fd, a - ft, a, c - ft, d + ft)
        M.box(mat, 0, fd, b, b + ft, c - ft, d + ft)
        M.box(mat, 0, fd, a - ft, b + ft, d, d + ft)
        M.box(mat, 0, fd, a - ft, b + ft, c - ft, c)
    if w.get("juliet"):
        rail = c + 100
        M.box(4, 6, 9, a + 4, b - 4, rail - 4, rail)
        M.box(4, 6, 9, a + 4, b - 4, c + 8, c + 11)
        n = max(2, int((b - a) / 14))
        for k in range(1, n):
            y = a + (b - a) * k / n
            M.box(4, 6, 9, y - 1, y + 1, c + 8, rail)


def panels(M, R, W, H, holes, alt):
    """MIXED METAL PANELS, the 2010s rental: the wall between the windows is
    cladding in two or three colours, set in a pattern that changes bay to bay
    (the alternate module flips it), proud of the backing wall by a joint"""
    pr = R["panels"]
    mats = [5, 7, 0] if pr.get("three", True) else [5, 0]
    flip = 1 if alt else 0
    for i, (a, b, c, d) in enumerate(holes):
        k = (i + flip) % len(mats)
        M.box(mats[k], 0, 4, a - 8, b + 8, 2, c - 4)                    # under the window
        M.box(mats[(k + 1) % len(mats)], 0, 4, a - 8, b + 8, d + 4, H - 2)  # over it
    if pr.get("vertical", True) and holes:
        M.box(mats[(flip + 2) % len(mats)], 0, 4, -W + 2, holes[0][0] - 10, 2, H - 2)


def features(M, R, W, H, holes):
    """the projecting things that give a facade depth, on the alternate bay
    module (so a building carries them up whole columns of bays): fire escapes,
    oriels, balconies, fins"""
    f = R.get("feature")
    if not f:
        return
    # a staggered module puts the feature on one half of the bay
    side = R.get("_side")
    ya, yb = (-W, 0) if not side else ((-W, -W / 2) if side == "L" else (-W / 2, 0))
    if f == "fire_escape":
        # an iron platform at each floor, railing, and the drop ladder's rails
        y0, y1 = -W + 15, -15
        # the platform is iron slats with light between them, not a plate
        for k in range(6):
            x = 4 + k * 17
            M.box(4, x, x + 9, y0, y1, 0, 4)
        M.box(4, 100, 105, y0, y1, 92, 97)                   # top rail
        M.box(4, 101, 104, y0, y1, 45, 47)                   # mid rail
        n_post = max(3, int((y1 - y0) / 45))
        for k in range(n_post + 1):                          # balusters
            y = y0 + (y1 - y0 - 3) * k / n_post
            M.box(4, 100, 104, y, y + 3, 0, 97)
        # the stair to the next platform: treads, and two thin stepped stringers
        # (a solid stringer sheet read as a black chute hiding the windows)
        n = 9
        run = W * 0.55
        for k in range(n):
            yy = y0 + 20 + k * (run / n)
            z = 5 + (H - 5) * (k + 1) / (n + 1)
            M.box(4, 24, 76, yy, yy + 14, z, z + 3)
            for xs in (20, 76):
                M.box(4, xs, xs + 4, yy, yy + run / n + 1, z - 12, z)
    elif f == "oriel":
        # a bay window carried up the front: a box out from the wall, glazed on three faces
        for a, b, c, d in holes:
            a2, b2 = a - 25, b + 25
            M.box(0, 0, 70, a2, b2, 0, H)                    # the oriel's own wall
            M.box(2, 70, 72, a + 5, b - 5, c, d)             # front light
            M.box(1, 68, 75, a2 - 4, b2 + 4, d + 6, d + 18)  # head moulding
            M.box(1, 68, 75, a2 - 4, b2 + 4, c - 10, c)      # sill
            M.box(2, 15, 55, a2 - 1, a2, c, d)               # side lights
            M.box(2, 15, 55, b2, b2 + 1, c, d)
    elif f == "balcony":
        bd = R.get("balcony_depth", 150)
        glass = R.get("balcony_glass", False)
        M.box(1, 0, bd, ya + 10, yb - 10, 0, 16)             # slab
        if glass:
            # a glass balustrade with a slim top rail, the contemporary condo
            M.box(2, bd - 4, bd - 2, ya + 10, yb - 10, 16, 105)
            M.box(4, bd - 5, bd - 1, ya + 10, yb - 10, 103, 107)
            M.box(2, 0, bd, ya + 10, ya + 12, 16, 105)
            M.box(2, 0, bd, yb - 12, yb - 10, 16, 105)
        else:
            M.box(4, bd - 5, bd, ya + 10, yb - 10, 16, 105)  # solid front (painted metal)
            M.box(4, 0, bd, ya + 10, ya + 14, 16, 105)
            M.box(4, 0, bd, yb - 14, yb - 10, 16, 105)
    elif f == "baguettes":
        # TERRACOTTA BAGUETTES: a screen of vertical clay rods across the bay
        # in front of the glass (the 2010s rainscreen); spacing and depth in
        # the recipe
        sp = R.get("baguette_spacing", 22)
        n = int(W / sp)
        for k in range(n):
            y = -W + (k + 0.5) * W / n
            M.box(5, 18, 24, y - 2.5, y + 2.5, 0, H)
        M.box(5, 0, 26, -W, 0, 0, 8)
    elif f == "fins":
        fd = R.get("fin_depth", 55)
        for y in (-W, -W / 2):
            M.box(1, 0, fd, y, y + 9, 0, H)


def ground(R, W, H, entrance=False, M=None):
    M = M or Mesh()
    g = R.get("ground", {})
    kind = g.get("type", "shop")
    mat = 3
    if kind == "shop" and not entrance:
        bulk, sign = g.get("bulkhead", 55), g.get("sign", 360)
        pw = g.get("pier", 40)
        hole = (-W + pw / 2, -pw / 2, bulk, sign - 15)
        wall_with_holes(M, mat, W, H, [hole])
        a, b = hole[0], hole[1]
        M.box(4, -25, -20, a, b, 0, bulk)                       # bulkhead
        M.box(2, -28, -24, a, b, bulk, sign - 15)               # shop glass
        M.box(1, -24, -20, a, b, bulk, bulk + 6)
        n = g.get("lights", 2)
        for k in range(1, n):
            y = a + (b - a) * k / n
            M.box(1, -24, -20, y - 3, y + 3, bulk, sign - 15)
        M.box(7 if g.get("tenant_sign") else 1, 0, 6, -W, 0, sign - 15, sign + 10)   # sign fascia (a tenant's colour)
        M.box(1, 0, 12, -W, 0, sign + 10, sign + 18)            # its cap
        if g.get("blade"):
            # a blade sign: the tenant's sign projecting from the pier, read down the street
            M.box(7, 8, 70, -pw / 2 - 4, -pw / 2 + 4, sign + 30, sign + 190)
            M.box(4, 0, 12, -pw / 2 - 2, -pw / 2 + 2, sign + 60, sign + 66)
            M.box(4, 0, 12, -pw / 2 - 2, -pw / 2 + 2, sign + 160, sign + 166)
        if g.get("awning"):
            # a canvas awning stepped out over the pavement in four courses
            for k in range(4):
                M.box(5, 0, 40 + k * 30, a + 5, b - 5, sign - 30 - k * 22, sign - 10 - k * 22)
    elif kind == "dock" and not entrance:
        # LOADING DOCKS: a roll-up door per bay over a raised dock, a steel
        # canopy over the run of them, bumpers at the dock edge
        dw, dh = min(W - 80, g.get("door_w", 300)), g.get("door_h", 360)
        a, b = -W / 2 - dw / 2, -W / 2 + dw / 2
        wall_with_holes(M, mat, W, H, [(a, b, 120, 120 + dh)])
        for z in range(120, int(120 + dh), 18):                     # the door's slats
            M.box(4, -20, -16, a, b, z, z + 15)
        M.box(3, 0, 140, a - 30, b + 30, 0, 120)                     # the dock
        M.box(4, 140, 150, a + 20, a + 45, 30, 100)                  # bumpers
        M.box(4, 140, 150, b - 45, b - 20, 30, 100)
        M.box(1, 0, 220, -W, 0, 120 + dh + 40, 120 + dh + 55)       # canopy
    elif kind == "arcade" and not entrance:
        # an arcade: columns on the street line, the shopfront set back behind
        # a covered walk, under a round or flat head
        pw = g.get("pier", 60)
        top = H - 70
        a, b = -W + pw / 2, -pw / 2
        M.box(mat, -DEPTH, 0, -W, 0, top, H)                       # the band over the arches
        M.box(mat, -DEPTH, 0, -W, a, 0, top)                       # half columns each side
        M.box(mat, -DEPTH, 0, b, 0, 0, top)
        if g.get("order") in ORDERS:
            # classical half columns: the base on the water table, the capital
            # where the arch's lowest course springs (the arch below is built
            # in 8 courses) or under the soffit of a flat head, so the head
            # rests on the abacus. Base and capital wrap the walk-side face.
            r = (b - a) / 2
            zi = top - r + r * math.sqrt(1 - (7 / 8.0) ** 2) if g.get("head", "arch") == "arch" else top
            order(M, g["order"], W, pw / 2, -DEPTH, 0, 30, max(zi, 30 + 0.4 * (top - 30)), mat, g.get("order_mat", 1))
        else:
            M.box(1, 0, 6, -W, a + 6, 0, 40)                       # column bases
            M.box(1, 0, 6, b - 6, 0, 0, 40)
        M.box(2, -DEPTH - 2, -DEPTH, a, b, 40, top - 20)           # shop glass at the back of the walk
        M.box(4, -DEPTH - 2, -DEPTH, a, b, 0, 40)
        M.box(mat, -DEPTH, 0, a, b, top - 6, top)                  # soffit
        if g.get("head", "arch") == "arch":
            r = (b - a) / 2
            c = (a + b) / 2
            n = 8
            for k in range(n):
                a0, a1 = k / float(n), (k + 1) / float(n)
                zc = top - r + r * math.sqrt(max(0.0, 1 - a0 * a0))
                M.box(mat, -12, 0, c + r * a0, c + r * a1, zc, top)
                M.box(mat, -12, 0, c - r * a1, c - r * a0, zc, top)
    elif entrance:
        dw = min(W - 60, g.get("door_w", 180))
        a, b = -W / 2 - dw / 2, -W / 2 + dw / 2
        dh = g.get("door_h", 300)
        dz = 144 if g.get("stoop") else 0                       # a stoop's door is a parlour floor up
        dh = min(dh, H - dz - 40)
        wall_with_holes(M, mat, W, H, [(a, b, dz, dz + dh)])
        M.box(4, -32, -28, a, b, dz, dz + dh * 0.72)            # doors
        M.box(2, -32, -28, a, b, dz + dh * 0.72, dz + dh)       # transom light
        M.box(1, -28, -24, a, b, dz + dh * 0.72, dz + dh * 0.72 + 6)
        M.box(1, 0, 8, a - 18, b + 18, dz + dh, dz + dh + 26)   # door surround head
        M.box(1, 0, 5, a - 18, a, dz, dz + dh)
        M.box(1, 0, 5, b, b + 18, dz, dz + dh)
        if dz:
            M.box(4, -32, -28, a, b, 0, dz)                     # under the stoop: the areaway door's shadow
        if g.get("stoop"):
            # THE STOOP: a straight stair from the pavement to a parlour-floor
            # door, stone treads and cheek walls, iron railings
            n, rise, run = 8, 18, 30
            for k in range(n):
                M.box(3, 0, run * (n - k), a - 20, b + 20, k * rise, (k + 1) * rise)
            M.box(3, 0, run * n, a - 32, a - 20, 0, n * rise + 15)
            M.box(3, 0, run * n, b + 20, b + 32, 0, n * rise + 15)
            for y in (a - 26, b + 26):
                for k in range(0, n, 2):
                    M.box(4, run * (n - k) - 6, run * (n - k) - 3, y - 1.5, y + 1.5, (k + 1) * rise, (k + 1) * rise + 90)
        elif g.get("canopy", True):
            M.box(4, 0, 110, a - 30, b + 30, dh + 26, dh + 40)
    else:
        # rusticated or plain stone base: windows set high, stone courses
        sill = g.get("sill", 110)
        holes = [(a, b, sill, min(H - 60, sill + 210)) for a, b in openings(R, W)]
        wall_with_holes(M, mat, W, H, holes)
        head = g.get("head", "keystone")
        # a rusticated base heads its windows with a fan of voussoirs in place
        # of a moulding ("voussoirs": false keeps the moulding; true gives a
        # plain base them too)
        vs = g.get("voussoirs", kind == "rusticated")
        wv = dict(R.get("win", {}), head=head)
        if vs:
            wv["head_trim"] = False
        Rw = dict(R, win=wv)
        for a, b, c, d in holes:
            window(M, Rw, a, b, c, d)
            if vs:
                ov = wv.get("surround_w", 12) if wv.get("surround", is_masonry(Rw)) else 6
                voussoirs(M, W, H, a, b, d, ov, keystone=head == "keystone", arch=head == "arch")
        if kind == "rusticated":
            # the courses stop at each opening, and at the apron panel under
            # its sill (which would otherwise sit flush with them), and end
            # under the band that caps the street floor
            cuts = list(holes)
            if wv.get("apron", is_masonry(Rw)):
                ah = wv.get("apron_h", 55)
                cuts += [(a + 6, b - 6, max(4, c - 9 - ah), c - 9) for a, b, c, d in holes]
            cuts.sort()
            for z in range(40, int(H), 45):
                za, zb = z, min(z + 37, H - 22)
                y = -W
                for a, b, c, d in cuts:
                    if c < zb and d > za:
                        M.box(3, 0, 3, y, a, za, zb)
                        y = max(y, b)
                M.box(3, 0, 3, y, 0, za, zb)
    # water table and the band that caps the street floor
    M.box(1, 0, 8, -W, 0, H - 22, H)
    M.box(3, 0, 6, -W, 0, 0, 30)
    return M


def mansard_profile(t, H):
    """a mansard's section, shared by the bay and its corner piece: the
    cornice's height and projection, and the stepped boxes that stand for the
    slope, as (z0, z1, front) from the foot up. The top step stands just in
    front of the building's mass (the city sets it 60 cm behind the face line,
    up to the roof, and it would hide anything further back); the foot is a
    run of (slope height / tan(slope)) in front of that, so the line through
    the steps' noses keeps the recipe's angle. At 70 degrees and 380 cm the
    foot lands a little proud of the wall plane, behind the cornice's edge."""
    ch, curb = float(t.get("cornice_h", 70)), 12.0
    n = max(2, min(4, int(t.get("steps", 3))))
    sh = H - ch - curb
    ang = math.radians(max(45.0, min(85.0, float(t.get("slope", 70)))))
    top_x = -55.0
    # the foot is held back so the cornice in front of it (and a dormer's cap) stay inside X = +120
    foot = min(94.0, top_x + (n - 1) * sh / n / math.tan(ang))
    d = (foot - top_x) / (n - 1)
    steps = [(ch + sh * k / n, ch + sh * (k + 1) / n, foot - d * k) for k in range(n)]
    proud = min(120.0, max(float(t.get("proud", 45)), foot + 18))
    return {"h": H, "ch": ch, "curb": curb, "steps": steps, "back": top_x - 20, "proud": proud}


def dormer_spots(R, t, W):
    """where a mansard's dormers stand across a bay, as (centre, half width of
    the light). "windows" (the default) sets one over each window of the floor
    below, so they stack with the bays; "bay" one per bay, centred (a ribbon
    facade always gets that); "none" leaves the slope bare. The lights narrow
    to leave each dormer its cheeks and a margin to its neighbours (and to
    the next module's), and a bay too tight for a 50 cm light gets none."""
    mode = t.get("dormers", "windows")
    if mode in (False, None, "none"):
        return []
    w = R.get("win", {})
    if mode == "bay" or w.get("ribbon"):
        cs = [-W / 2.0]
    else:
        cs = [(a + b) / 2.0 for a, b in openings(R, W)]
    room = min([min(c + W, -c) for c in cs] + [(b - a) / 2.0 for a, b in zip(cs, cs[1:])])
    hw = min(float(t.get("dormer_w", min(w.get("w", 120), 130))) / 2.0, room - 10 - 12)
    return [(c, hw) for c in cs] if hw >= 25 else []


def dormer(M, t, P, c, hw):
    """one dormer on a mansard (P, its profile), centred at c with a light
    2*hw wide: a box out from the slope, glazed between trim cheeks, on a
    sill, under a stepped pediment, a flat cap or a round head. Its face
    stands a little proud of the slope's foot and its back is buried in the
    top step, so its cheeks show against each step behind it."""
    sw = 10                                   # the cheeks
    fd = P["steps"][0][2] + 16                # the face
    bk = P["back"] + 5
    head = t.get("dormer_head", "pediment")
    ew = hw + sw + 6                          # the head's half width
    rise = min(40.0, 0.44 * ew)
    z0 = P["ch"] + 22                         # the light's sill
    room = P["h"] - P["curb"] - 8 - z0        # sill to just under the curb
    if head == "pediment" and room - 10 - rise < 60:
        head = "flat"                         # a low mansard: a flat cap leaves the light more height
    head_h = 10 + rise if head == "pediment" else 14
    dh = min(float(t.get("dormer_h", 150)), room - head_h)
    if dh < 60:
        return
    z1 = z0 + dh
    if head == "arch" and dh < hw + 30:
        head = "flat"                         # too squat a light for a round head
    r = hw if head == "arch" else 0.0
    M.box(1, bk, fd + 4, c - hw - sw - 3, c + hw + sw + 3, z0 - 8, z0)   # sill
    M.box(1, bk, fd, c - hw - sw, c - hw, z0, z1)                        # cheeks
    M.box(1, bk, fd, c + hw, c + hw + sw, z0, z1)
    M.box(2, fd - 8, fd - 6, c - hw, c + hw, z0, z1)                     # glass, in a 6 cm reveal
    zm = (z0 + z1 - r) / 2
    M.box(1, fd - 6, fd - 3, c - 2.5, c + 2.5, z0, z1)                   # sash bars and frame head
    M.box(1, fd - 6, fd - 3, c - hw, c + hw, zm - 2.5, zm + 2.5)
    M.box(1, fd - 6, fd - 3, c - hw, c + hw, z1 - 5, z1)
    if head == "pediment":
        M.box(1, bk, fd + 5, c - ew, c + ew, z1, z1 + 10)                # entablature
        for k in range(3):
            # three courses, each the width of a triangle at its mid-height
            f = 1 - (k + 0.5) / 3.0
            M.box(1, bk, fd + 3, c - ew * f, c + ew * f, z1 + 10 + rise * k / 3, z1 + 10 + rise * (k + 1) / 3)
    else:
        if head == "arch":
            # the head of the light steps in over the top in courses, as a window's arch does
            n = 5
            for k in range(1, n):
                a0, a1 = k / float(n), (k + 1) / float(n)
                zc = z1 - r + r * math.sqrt(max(0.0, 1 - a0 * a0))
                M.box(1, fd - 6, fd, c + r * a0, c + r * a1, zc, z1)
                M.box(1, fd - 6, fd, c - r * a1, c - r * a0, zc, z1)
        M.box(1, bk, fd + 6, c - ew, c + ew, z1, z1 + 14)                # cap


def top(R, W, corner=False, M=None):
    t = R.get("top", {})
    kind = t.get("type", "cornice")
    H = t.get("h", 380 if kind == "mansard" else 150)
    M = M or Mesh()
    if kind == "cornice":
        M.box(0, -DEPTH, 0, -W, 0, 0, H * 0.55)                 # frieze
        M.box(1, 0, 6, -W, 0, H * 0.55 - 10, H * 0.55)          # architrave line
        p = t.get("proud", 45)
        M.box(1, 0, p * 0.5, -W, 0, H * 0.55, H * 0.72)         # bed moulding
        if t.get("brackets", True):
            n = max(1, int(W / 60))
            for k in range(n):
                y = -W + (k + 0.5) * W / n
                M.box(1, 0, p * 0.85, y - 7, y + 7, H * 0.55, H * 0.85)
        M.box(1, 0, p, -W, 0, H * 0.85, H)                      # corona
    elif kind == "parapet":
        M.box(0, -DEPTH, 0, -W, 0, 0, H)
        M.box(1, -DEPTH, 6, -W, 0, H - 12, H)                    # coping
        M.box(1, 0, 4, -W, 0, 0, 12)
    elif kind == "deco":
        # a deco parapet: fluted panel, a stepped double coping
        M.box(0, -DEPTH, 0, -W, 0, 0, H)
        for k in range(4):
            y = -W + (k + 0.5) * W / 4
            M.box(1, 0, 4, y - 6, y + 6, 15, H - 30)
        M.box(1, -DEPTH, 5, -W, 0, H - 30, H - 18)
        M.box(1, -DEPTH, 9, -W, 0, H - 10, H)
    elif kind == "band":
        M.box(1, -DEPTH, 4, -W, 0, 0, H)
    elif kind == "mansard":
        # a mansard: a bracketed cornice, then a steep slate roof (slot 6),
        # its slope stood for by boxes that step back to a curb at the top,
        # with dormers over the windows below. The corner piece carries the
        # same cornice and steps, without dormers.
        P = mansard_profile(t, H)
        ch, p = P["ch"], P["proud"]
        M.box(0, -DEPTH, 0, -W, 0, 0, ch)                       # frieze
        M.box(1, 0, 6, -W, 0, ch * 0.45 - 8, ch * 0.45)         # architrave line
        M.box(1, 0, p * 0.5, -W, 0, ch * 0.45, ch * 0.7)        # bed moulding
        if t.get("brackets", True):
            n = max(1, int(W / 60))
            for k in range(n):
                y = -W + (k + 0.5) * W / n
                M.box(1, 0, p * 0.85, y - 7, y + 7, ch * 0.45, ch * 0.85)
        M.box(1, 0, p, -W, 0, ch * 0.85, ch)                    # corona
        for z0, z1, f in P["steps"]:
            M.box(6, P["back"], f, -W, 0, z0, z1)
        M.box(1, P["back"], P["steps"][-1][2] + 6, -W, 0, H - P["curb"], H)   # curb
        if not corner:
            for c, hw in dormer_spots(R, t, W):
                dormer(M, t, P, c, hw)
    return M, H


def corner(R, H, mid=0, quoins=False, glazed=False, M=None):
    M = M or Mesh()
    if glazed:
        # MODERNE / CONTEMPORARY CORNER WINDOW: the glass wraps the corner
        w = R.get("win", {})
        sill = w.get("sill", 90)
        top = min(H - 30, sill + w.get("h", 170))
        M.box(mid, -DEPTH, 0, -100, 0, 0, sill)
        M.box(mid, -DEPTH, 0, -100, 0, top, H)
        M.box(2, -8, -4, -100, 0, sill, top)
        M.box(2, -DEPTH, -4, -4, 0, sill, top)               # the return face
        M.box(4, -6, -2, -100, 0, sill, sill + 5)
        M.box(4, -6, -2, -100, 0, top - 5, top)
        for z in range(int(sill) + 40, int(top) - 10, 40):
            M.box(4, -6, -2, -100, 0, z, z + 2)              # horizontal muntins
        return M
    M.box(mid, -DEPTH, 0, -100, 0, 0, H)
    if quoins:
        for z in range(0, int(H) - 30, 60):
            M.box(1, 0, 3, -100, -100 + (70 if (z // 60) % 2 else 50), z, z + 30)
    return M


# ---------------------------------------------------------------- assets

def save(M, path, slots):
    s = UV_SCALE[0]
    UV.set_mesh_u_vs_from_box_projection(M.m, 0, unreal.Transform(scale=[s, s, s]), unreal.GeometryScriptMeshSelection())
    o = unreal.GeometryScriptCreateNewStaticMeshAssetOptions()
    o.enable_recompute_normals = True
    o.enable_recompute_tangents = True
    o.enable_nanite = True
    o.enable_collision = False
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        unreal.EditorAssetLibrary.delete_asset(path)
    sm, outcome = unreal.GeometryScript_NewAssetUtils.create_new_static_mesh_asset_from_mesh(M.m, path, o)
    if sm is None:
        unreal.log_error("STYLE could not create %s (%s)" % (path, outcome))
        return None
    mats = [unreal.StaticMaterial(material_interface=unreal.load_asset(m), material_slot_name=n) for n, m in slots]
    sm.set_editor_property("static_materials", mats)
    unreal.EditorAssetLibrary.save_loaded_asset(sm)
    return sm


def module(path, W, depth=DEPTH):
    name = path.split("/")[-1]
    return {"path": path + "." + name, "width": W, "depth": depth, "y0": -W, "y1": 0}


def slots_for(R):
    m = R["mats"]
    return [("wall", mat_path(m["wall"])), ("trim", mat_path(m.get("trim", m["wall"]))),
            ("glass", mat_path(m.get("glass", MATS["glass"])) if m.get("glass") else MATS["glass"]),
            ("base", mat_path(m.get("base", m["wall"]))), ("dark", mat_path(m.get("dark", MATS["dark"])) if m.get("dark") else MATS["dark"]),
            ("accent", mat_path(m.get("accent", "Paint/PaintedMetal_Green"))),
            ("roof", mat_path(m.get("roof", "Paint/PaintedStone_charcoal"))),
            ("accent2", mat_path(m.get("accent2", "Paint/PaintedMetal_White"))),
            ("blind", mat_path(m.get("blind", "Paint/PaintedStone_Beige")))]


def zoned(R, z):
    """the recipe as one facade zone wears it: the zone's own fields over the
    building's (materials merged key by key, windows likewise)"""
    Z = dict(R)
    for k, v in z.items():
        if k in ("mats", "win", "pier", "spandrel") and isinstance(v, dict):
            Z[k] = dict(R.get(k, {}), **v)
        else:
            Z[k] = v
    return Z


def cheeks(M, W, H, proud):
    """the returns of a popped-out or set-back zone: wall at each side of the
    module from the main face plane to the zone's; inside a run the next bay
    covers them, at the run's ends they are the corner of the volume"""
    lo, hi = (0, proud) if proud > 0 else (proud, 0)
    x = M.xoff
    M.xoff = 0
    M.box(0, lo, hi, -W, -W + 1.5, 0, H)
    M.box(0, lo, hi, -1.5, 0, 0, H)
    M.xoff = x


def build(R, data_dir):
    UV_SCALE[0] = float(R.get("uv", 2.0))
    key = R["key"]
    # each run writes a fresh version folder: a running game holds the last
    # version's files open, and overwriting them in place fails (the kit JSON
    # names the version, so the game picks up whichever it was written with)
    base = "%s/%s/%s" % (ROOT, key, RUN)
    slots = slots_for(R)
    W = float(R.get("bay", 360))
    Hs = float(R.get("storey", 355))
    Hg = float(R.get("ground", {}).get("h", 450))
    bands = [{"symbol": "F", "height": 0.5, "repeat": False, "walls": [], "entrances": [], "corner": None, "inner": None}]
    def band(sym, h, walls, entrances=(), corner_m=None, rep=False, gr=False, storeys=0):
        b = {"symbol": sym, "height": h, "repeat": rep, "walls": walls, "entrances": list(entrances), "corner": corner_m, "inner": None}
        if storeys:
            b["storeys"] = storeys
        if gr:
            b["ground"] = True
        bands.append(b)
    # street floor
    gw = []
    for i, wid in enumerate([W, W * 0.8, W * 1.2]):
        p = "%s/SM_%s_Ground_%d" % (base, key, i)
        save(ground(R, wid, Hg), p, slots)
        gw.append(module(p, wid))
    # A STREET OF TENANTS. Each shop bay is somebody's: its own awning colour
    # or none, its own sign band. Shopfront variants share a mix group, so
    # FacadeBuilder gives each bay its own (the architecture is unchanged).
    if R.get("ground", {}).get("type", "shop") == "shop" and R.get("ground", {}).get("tenants", True):
        gw[0]["mix"] = 50
        palette = ["Paint/PaintedMetal_Red", "Paint/PaintedMetal_Green", "Paint/PaintedMetal_Black",
                   "Paint/PaintedMetal_Grey", "Paint/PaintedStone_Khaki", "Paint/PaintedStone_charcoal",
                   "Paint/PaintedMetal_White", "Metal/Metal_Brass"]
        for v in range(1, 5):
            h = (sum(ord(c) for c in key) * 31 + v * 977) % 1000
            a1 = palette[h % len(palette)]
            a2 = palette[(h // 7 + v) % len(palette)]
            gv = dict(R["ground"], awning=(h % 3) != 0, tenant_sign=True, blade=(h % 5) in (1, 3))
            Rv = dict(R, ground=gv, mats=dict(R["mats"], accent=a1, accent2=a2))
            pv = "%s/SM_%s_Ground_0_v%d" % (base, key, v)
            save(ground(Rv, W, Hg), pv, slots_for(Rv))
            mv = module(pv, W)
            mv["mix"] = 50
            mv["variant"] = True
            gw.append(mv)
    pe = "%s/SM_%s_Entrance" % (base, key)
    save(ground(R, W, Hg, entrance=True), pe, slots)
    pc = "%s/SM_%s_GroundCorner" % (base, key)
    save(corner(R, Hg, 3, quoins=R.get("quoins", False)), pc, slots)
    # a residential base carries the zones down to the pavement (the volumes
    # stand on the ground); a retail podium stays one continuous base
    if R.get("zones") and R.get("ground", {}).get("type", "shop") != "shop":
        for zi, z in enumerate(R["zones"]):
            Z = zoned(R, z)
            Mg = Mesh()
            Mg.xoff = float(z.get("proud", 0))
            ground(Z, W, Hg, M=Mg)
            if Mg.xoff:
                cheeks(Mg, W, Hg, Mg.xoff)
            pz = "%s/SM_%s_GroundZone_%d" % (base, key, zi)
            save(Mg, pz, slots_for(dict(Z, mats=dict(Z["mats"], base=Z["mats"]["wall"]))))
            mz = module(pz, W)
            mz["zone"] = zi
            gw.append(mz)
    band("G", Hg, gw, [module(pe, W)], module(pc, 100), gr=True)
    # an optional second-floor band (a piano nobile or a transfer floor)
    if R.get("second"):
        R2 = dict(R, **R["second"])
        p = "%s/SM_%s_Second" % (base, key)
        save(typical(R2, W, float(R["second"].get("storey", Hs))), p, slots)
        pcs = "%s/SM_%s_SecondCorner" % (base, key)
        save(corner(R, float(R["second"].get("storey", Hs)), 0, quoins=R.get("quoins", False)), pcs, slots)
        band("P", float(R["second"].get("storey", Hs)), [module(p, W)], (), module(pcs, 100))
    # typical floor: two variants at slightly different widths, so bays pick the best fit
    tw = []
    stagger = R.get("stagger") and R.get("feature")
    for i, wid in enumerate([W, W]):   # same width: the fit filter keeps both, so the feature bay is used
        p = "%s/SM_%s_Typical_%d" % (base, key, i)
        if stagger:
            # STAGGERED: a two-storey piece with the feature on the left half of
            # one floor and the right half of the next (the other variant the
            # other way round), so balconies checkerboard up the facade
            M = Mesh()
            first, second = ("L", "R") if i == 0 else ("R", "L")
            typical(dict(R, _side=first), wid, Hs, alt=True, M=M)
            M.zoff = Hs
            typical(dict(R, _side=second), wid, Hs, alt=True, M=M)
            save(M, p, slots)
        else:
            save(typical(R, wid, Hs, alt=(i == 1) or R.get("feature_all", False)), p, slots)
        tw.append(module(p, wid))
    # a feature bay that is not on every bay (fire escape, oriel) goes on one bay in N
    # along each wall (FacadeBuilder: FBWKitModule::Every), not one every other bay
    if R.get("feature") and not R.get("feature_all") and not R.get("stagger"):
        tw[1]["every"] = int(R.get("feature_every", 4 if R["feature"] == "fire_escape" else 3))
    # LIVED-IN VARIANTS: the plain shaft piece again three times, differing
    # only in their blinds; FacadeBuilder picks among a piece's "mix" group
    # per bay and per floor, so the windows vary while the architecture
    # stays one rhythm
    def blind_variants(make, path0, mz, mix):
        mz["mix"] = mix
        out = []
        for v in range(1, 4):
            BLINDS[0], BLINDS[1] = v * 13 + mix * 101, 0
            Mv = make()
            BLINDS[0] = None
            pv = "%s_v%d" % (path0, v)
            save(Mv, pv, slots_vars[0])
            mv = module(pv, mz["width"])
            mv["mix"] = mix
            mv["variant"] = True
            if "zone" in mz:
                mv["zone"] = mz["zone"]
            out.append(mv)
        return out
    slots_vars = [slots]
    if not stagger:
        tw += blind_variants(lambda: typical(R, W, Hs, alt=R.get("feature_all", False)),
                             "%s/SM_%s_Typical_0" % (base, key), tw[0], 0)
    # FACADE ZONES: one shaft piece per zone, each in its own cladding and
    # depth; FacadeBuilder sets them out in mirrored runs along every wall
    for zi, z in enumerate(R.get("zones", [])):
        Z = zoned(R, z)
        p = "%s/SM_%s_Zone_%d" % (base, key, zi)
        M = Mesh()
        M.xoff = float(z.get("proud", 0))
        typical(Z, W, Hs, alt=bool(Z.get("feature")) and Z.get("feature_all", True), M=M)
        if M.xoff:
            cheeks(M, W, Hs, M.xoff)
        save(M, p, slots_for(Z))
        mz = module(p, W)
        mz["zone"] = zi
        tw.append(mz)
        def mk(Z=Z, z=z):
            Mv = Mesh()
            Mv.xoff = float(z.get("proud", 0))
            typical(Z, W, Hs, alt=bool(Z.get("feature")) and Z.get("feature_all", True), M=Mv)
            if Mv.xoff:
                cheeks(Mv, W, Hs, Mv.xoff)
            return Mv
        slots_vars[0] = slots_for(Z)
        tw += blind_variants(mk, p, mz, 10 + zi)
        slots_vars[0] = slots
    pct = "%s/SM_%s_TypicalCorner" % (base, key)
    Hband = Hs * 2 if stagger else Hs
    if stagger and R.get("corner_window"):
        Mc = corner(R, Hs, 0, glazed=True)
        Mc.zoff = Hs
        corner(R, Hs, 0, glazed=True, M=Mc)
        save(Mc, pct, slots)
    elif stagger:
        save(corner(R, Hband, 0, quoins=R.get("quoins", False)), pct, slots)
    else:
        save(corner(R, Hs, 0, quoins=R.get("quoins", False), glazed=R.get("corner_window", False)), pct, slots)
    band("S", Hband, tw, (), module(pct, 100), rep=True, storeys=2 if stagger else 0)
    # top
    if R.get("top", {}).get("type", "cornice") != "none":
        Mt, Ht = top(R, W)
        p = "%s/SM_%s_Top" % (base, key)
        save(Mt, p, slots)
        Mtc, _ = top(R, 100, corner=True)
        pct2 = "%s/SM_%s_TopCorner" % (base, key)
        save(Mtc, pct2, slots)
        tops = [module(p, W)]
        for zi, z in enumerate(R.get("zones", [])):
            Z = zoned(R, z)
            Mz = Mesh()
            Mz.xoff = float(z.get("proud", 0))
            Mz, Hz = top(Z, W, M=Mz)
            if Mz.xoff:
                cheeks(Mz, W, Hz, Mz.xoff)
            pz = "%s/SM_%s_TopZone_%d" % (base, key, zi)
            save(Mz, pz, slots_for(Z))
            mz = module(pz, W)
            mz["zone"] = zi
            tops.append(mz)
        band("T", Ht, tops, (), module(pct2, 100))
        if R["top"].get("type") == "mansard":
            # how far the roof's top step stands behind the face line: a hint
            # for the city, whose roof cap today runs out to the face line and
            # so covers the upper slope from above (ignored by the kit loader)
            bands[-1]["setback"] = -mansard_profile(R["top"], Ht)["steps"][-1][2]
    kit = {"format": "bw-kit/1", "kit": key, "grammar": "generated", "label": R.get("label", key), "bands": bands}
    with open("%s/kit-%s.json" % (data_dir, key), "w") as f:
        json.dump(kit, f, indent=1)
    unreal.log("STYLE %s built (%d bands)" % (key, len(bands)))


def prune(key):
    """drop this style's older versions (and its pre-versioning files); any a
    running game still holds are left for the next run"""
    reg = unreal.AssetRegistryHelpers.get_asset_registry()
    for d in reg.get_sub_paths("%s/%s" % (ROOT, key), False):
        if d.split("/")[-1] != RUN:
            unreal.EditorAssetLibrary.delete_directory(d)
    for a in unreal.EditorAssetLibrary.list_assets("%s/%s" % (ROOT, key), recursive=False):
        unreal.EditorAssetLibrary.delete_asset(a)


def main():
    recipes_path, data_dir = sys.argv[1], sys.argv[2]
    only = set(sys.argv[3:])
    recipes = json.load(open(recipes_path))
    n = 0
    for R in recipes:
        if only and R["key"] not in only:
            continue
        try:
            build(R, data_dir)
            try:
                prune(R["key"])
            except Exception as e:
                unreal.log_warning("STYLE %s: old versions kept (%s)" % (R["key"], e))
            n += 1
        except Exception as e:
            unreal.log_error("STYLE %s failed: %s" % (R.get("key"), e))
            raise
    unreal.log("STYLES %d built" % n)


main()
