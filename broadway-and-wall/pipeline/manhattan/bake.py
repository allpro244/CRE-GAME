"""Bake the real Manhattan plat into src/citygen/data/manhattan-plat.json.

    pip install shapely            # 2.1 or later
    python3 pipeline/manhattan/fetch.py  [rawdir]
    python3 pipeline/manhattan/bake.py   [rawdir]

WHY THIS EXISTS. The first written-down Manhattan was the generator's own
lattices laid at the Commissioners' bearing over a coastline traced from
memory: the right idea at the wrong resolution. Its avenues were wherever a
244 m pitch happened to put them, so Fifth Avenue was not where Fifth Avenue
is, Broadway was a straight reservation laid over the grid, the parks were
four-cornered guesses with a pond dug in each one (Washington Square has a
fountain), and the colonial lanes below Chambers were a random organic tangle
rather than Wall, Pearl and Broad. A player looking for the block behind Grand
Central could not find it, because it was not there.

This bakes the real thing from the city's own records instead:

  * every BLOCK is the union of its real MapPLUTO tax lots, so the streets are
    the real streets -- they are simply the ground no tax lot covers;
  * every LOT is a real tax lot, with its real BBL and street address;
  * each block's STREET CELL (the ground out to the middle of the streets round
    it) is the Voronoi region of its boundary, so a street's two kerbs meet at
    its real centre line and every street is its real width;
  * the PARKS are the city's open-space lots (land use 09), named from Parks
    Properties;
  * the COAST is the borough boundary clipped to the shoreline;
  * each EXTENT is cut along the real centre line of its street (Houston is
    not straight, and the cut follows it).

What the seed deals is unchanged: which lots are built, how tall, how old, who
owns them and what the market does. The ground is history; the stock is not.

Coordinates are metres in the frame of geom.mjs `makeProjection(CENTER)`,
stored as integer decimetres, rings flattened to [x0, y0, x1, y1, ...].
"""
import json, math, os, re, sys
from collections import defaultdict

import shapely
from shapely.geometry import shape, Polygon, MultiPolygon, LineString, MultiPoint, Point, box
from shapely.ops import split, linemerge

ROOT = os.path.dirname(os.path.abspath(__file__))
RAW = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "raw")
OUT = os.path.normpath(os.path.join(ROOT, "..", "..", "src", "citygen", "data", "manhattan-plat.json"))

# Must match manhattan.mjs CENTER and geom.mjs R.
CENTER = (-73.9712, 40.7831)
R = 6378137.0
KX = math.pi / 180 * R * math.cos(CENTER[1] * math.pi / 180)
KY = math.pi / 180 * R

# The extents, south to north, each cut along its real street. The ids match
# manhattan.mjs EXTENTS; the order is the order a block is first included in.
EXTENTS = [
    ("houston", ["W HOUSTON ST", "E HOUSTON ST"]),
    ("14th", ["W 14 ST", "E 14 ST"]),
    ("23rd", ["W 23 ST", "E 23 ST"]),
    ("34th", ["W 34 ST", "E 34 ST"]),
    ("42nd", ["W 42 ST", "E 42 ST"]),
    ("59th", ["W 59 ST", "E 59 ST", "CENTRAL PARK S"]),
]

# Corridors the class ladder reads (a lot on a retail spine is a shop): the
# avenues, Broadway and the wide crosstown streets. Names as CSCL labels them.
CORRIDORS = [
    "BROADWAY", "BOWERY", "12 AVE", "11 AVE", "10 AVE", "9 AVE", "8 AVE", "7 AVE",
    "AVE OF THE AMERICAS", "5 AVE", "MADISON AVE", "PARK AVE", "PARK AVE S", "LEXINGTON AVE",
    "3 AVE", "2 AVE", "1 AVE", "YORK AVE", "AVE A", "AVE B", "AVE C", "AVE D",
    "HUDSON ST", "GREENWICH ST", "WEST ST", "CHURCH ST", "WEST BROADWAY", "LAFAYETTE ST",
    "CENTRE ST", "WATER ST", "WALL ST", "CANAL ST", "W HOUSTON ST", "E HOUSTON ST",
    "DELANCEY ST", "W 14 ST", "E 14 ST", "W 23 ST", "E 23 ST", "W 34 ST", "E 34 ST",
    "W 42 ST", "E 42 ST", "W 57 ST", "E 57 ST", "CHAMBERS ST", "FULTON ST", "GRAND ST",
    "AVE OF THE AMERICAS", "UNIVERSITY PL", "IRVING PL", "8 ST", "ST MARKS PL",
]

TH = 29 * math.pi / 180
UP = (math.sin(TH), math.cos(TH))       # uptown, along the avenues
AC = (math.cos(TH), -math.sin(TH))      # across, along the cross streets


def xy(lon, lat):
    return ((lon - CENTER[0]) * KX, (lat - CENTER[1]) * KY)


def proj(geom):
    return shapely.transform(geom, lambda a: [[*xy(*p)] for p in a])


def flat(ring):
    """A shapely ring -> [x0, y0, ...] in integer decimetres, open (no repeat)."""
    cs = list(ring.coords)[:-1]
    out = []
    for x, y in cs:
        out += [round(x * 10), round(y * 10)]
    return out


def biggest(g):
    if g.is_empty:
        return None
    if g.geom_type == "Polygon":
        return g
    polys = [p for p in getattr(g, "geoms", []) if p.geom_type == "Polygon"]
    return max(polys, key=lambda p: p.area) if polys else None


def parts(g):
    if g.is_empty:
        return []
    if g.geom_type == "Polygon":
        return [g]
    return [p for p in getattr(g, "geoms", []) if p.geom_type == "Polygon"]


def solid(p):
    """Exterior only, oriented CCW, collinear vertices dropped."""
    p = Polygon(p.exterior).simplify(0.05)
    return shapely.geometry.polygon.orient(p, 1.0)


# ------------------------------------------------------------------ address
ORD = lambda n: f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"
WORD = {"STREET": "St", "AVENUE": "Ave", "PLACE": "Pl", "SQUARE": "Sq", "LANE": "Ln",
        "BOULEVARD": "Blvd", "DRIVE": "Dr", "PLAZA": "Plaza", "SLIP": "Slip", "ROAD": "Rd",
        "WEST": "W", "EAST": "E", "NORTH": "N", "SOUTH": "S", "PARK": "Park", "TERRACE": "Ter",
        "CIRCLE": "Cir", "COURT": "Ct", "ALLEY": "Alley", "WAY": "Way"}


def tidy_address(a):
    """'350 5 AVENUE' -> '350 Fifth Ave'-ish: '350 5th Ave'; 'WEST 14 STREET' -> 'W 14th St'."""
    if not a:
        return ""
    a = re.sub(r"\s+", " ", a.strip().upper())
    toks = a.split(" ")
    out = []
    for i, t in enumerate(toks):
        nxt = toks[i + 1] if i + 1 < len(toks) else ""
        if t.isdigit() and i > 0 and nxt in ("STREET", "AVENUE", "ST", "AVE"):
            out.append(ORD(int(t)))
        elif t in WORD and i > 0:
            out.append(WORD[t])
        elif re.fullmatch(r"\d+[A-Z]?(-\d+[A-Z]?)?", t):
            out.append(t)
        else:
            out.append(t.capitalize() if len(t) > 2 or not t.isalpha() else t.capitalize())
    s = " ".join(out)
    s = s.replace("Avenue Of The Americas", "Sixth Ave").replace("Ave Of The Americas", "Sixth Ave")
    return s


def main():
    print("land")
    boro = json.load(open(os.path.join(RAW, "boro.geojson")))
    land = proj(biggest(shape(boro["features"][0]["geometry"])))
    land = Polygon(land.exterior).simplify(1.0)

    # ---------------------------------------------------------------- cuts
    print("cuts")
    cl = json.load(open(os.path.join(RAW, "centerline.json")))
    by_label = defaultdict(list)
    for r in cl:
        g = r.get("the_geom")
        lab = r.get("stname_label")
        if not g or not lab:
            continue
        by_label[lab].append((proj(shape(g)), r))

    battery = Point(*xy(-74.0150, 40.7030))
    south_of = {}
    for ext, names in EXTENTS:
        pts = []
        for n in names:
            for g, r in by_label[n]:
                if r.get("rw_type") not in ("1", None):
                    continue
                for ln in getattr(g, "geoms", [g]):
                    pts += list(ln.coords)
        # Sorted across the island the street is monotone, so the polyline can
        # never cross itself, whatever its bends.
        ac = lambda p: p[0] * AC[0] + p[1] * AC[1]
        pts.sort(key=ac)
        # thin to one vertex per 25 m so a divided roadway does not zig-zag
        line = [pts[0]]
        for p in pts[1:]:
            if ac(p) - ac(line[-1]) >= 25:
                line.append(p)
        a, b = line[0], line[-1]
        ext_a = (a[0] - AC[0] * 8000, a[1] - AC[1] * 8000)
        ext_b = (b[0] + AC[0] * 8000, b[1] + AC[1] * 8000)
        cut = LineString([ext_a, *line, ext_b])
        big = land.buffer(1500)
        pieces = split(big, cut)
        assert len(pieces.geoms) >= 2, f"the {ext} cut did not divide the island"
        south = next(p for p in pieces.geoms if p.contains(battery))
        south_of[ext] = south
        print(f"  {ext}: {len(line)} vertices")

    # --------------------------------------------------------------- lots
    print("lots")
    pluto = json.load(open(os.path.join(RAW, "pluto.geojson")))
    top = south_of[EXTENTS[-1][0]]
    lots, park_lots = [], []
    for f in pluto["features"]:
        if not f["geometry"]:
            continue
        p = f["properties"]
        lu = p.get("LandUse")
        if lu is None:
            continue
        g = proj(shape(f["geometry"]))
        if not g.is_valid:
            g = shapely.make_valid(g)
        g = biggest(g)
        if g is None or g.area < 20:
            continue
        if not top.contains(g.representative_point()):
            continue
        # piers and bulkhead lots: keep the part on the island
        on = g.intersection(land)
        if on.area < 0.5 * g.area:
            continue
        g = biggest(on)
        if g is None or g.area < 20:
            continue
        rec = dict(geom=g, bbl=str(int(float(p["BBL"]))), block=int(p["Block"]), lot=int(p["Lot"]),
                   addr=tidy_address(p.get("Address")), lu=lu)
        (park_lots if lu == "09" else lots).append(rec)
    print(f"  {len(lots)} lots, {len(park_lots)} open-space lots")

    # Snap every lot to one 10 cm lattice and simplify them TOGETHER as a
    # coverage, so two lots that share a party line still share it after.
    allg = [r["geom"] for r in lots] + [r["geom"] for r in park_lots]
    allg = [Polygon(g.exterior) for g in allg]
    allg = list(shapely.coverage_simplify(allg, 0.35))
    allg = [biggest(shapely.make_valid(shapely.set_precision(g, 0.1))) for g in allg]
    for r, g in zip(lots + park_lots, allg):
        r["geom"] = g
    lots = [r for r in lots if r["geom"] is not None and r["geom"].area >= 20]
    park_lots = [r for r in park_lots if r["geom"] is not None and r["geom"].area >= 20]

    # -------------------------------------------------------------- blocks
    print("blocks")
    by_block = defaultdict(list)
    for r in lots:
        by_block[r["block"]].append(r)
    blocks = []
    for bn, rs in by_block.items():
        u = shapely.union_all([r["geom"] for r in rs]).buffer(0.05, join_style="mitre").buffer(-0.05, join_style="mitre")
        for part in parts(u):
            if part.area < 60:
                continue
            outline = solid(part)
            mine = [r for r in rs if part.contains(r["geom"].representative_point())]
            if not mine:
                continue
            blocks.append(dict(n=bn, outline=outline, lots=mine))
    print(f"  {len(blocks)} blocks")

    # --------------------------------------------------------------- parks
    print("parks")
    pp = json.load(open(os.path.join(RAW, "parks.geojson")))
    named = []
    for f in pp["features"]:
        if not f["geometry"]:
            continue
        nm = f["properties"].get("signname") or f["properties"].get("name311")
        if not nm:
            continue
        g = proj(shape(f["geometry"]))
        if not g.is_valid:
            g = shapely.make_valid(g)
        named.append((g, nm))
    pk_by_block = defaultdict(list)
    for r in park_lots:
        pk_by_block[r["block"]].append(r["geom"])
    parks = []
    for bn, gs in pk_by_block.items():
        u = shapely.union_all(gs).buffer(0.05, join_style="mitre").buffer(-0.05, join_style="mitre")
        for part in parts(u):
            if part.area < 250:
                continue
            outline = solid(part.simplify(0.6))
            best, ba = None, 0
            for g, nm in named:
                if not g.intersects(outline):
                    continue
                a = g.intersection(outline).area
                if a > ba:
                    best, ba = nm, a
            parks.append(dict(name=best or "Open space", outline=outline))
    print(f"  {len(parks)} parks")

    # --------------------------------------------------------- street cells
    # The Voronoi region of each block's boundary: every point of street is
    # handed to the block whose kerb is nearest, so two blocks' cells meet on
    # the street's centre line, whatever its width.
    print("cells")
    sites, owner, seen = [], [], set()
    owners = [b["outline"] for b in blocks] + [p["outline"] for p in parks]
    for k, poly in enumerate(owners):
        ring = poly.exterior
        n = max(4, int(ring.length / 4.0))
        for i in range(n):
            pt = ring.interpolate(i * ring.length / n)
            key = (round(pt.x, 1), round(pt.y, 1))
            if key in seen:
                continue
            seen.add(key)
            sites.append((pt.x, pt.y))
            owner.append(k)
    print(f"  {len(sites)} sites")
    vor = shapely.voronoi_polygons(MultiPoint(sites), extend_to=land.buffer(200), ordered=True)
    groups = defaultdict(list)
    for k, cell in zip(owner, vor.geoms):
        groups[k].append(cell)
    cells = []
    for k in range(len(owners)):
        # A cell does not reach further than half the widest avenue-plus-
        # highway: past that it is the FDR or a rail yard, not this block's
        # street, and it is drawn as plain ground.
        reach = owners[k].buffer(36, join_style="mitre").intersection(land)
        bits = [shapely.make_valid(g).intersection(reach) for g in groups[k]]
        bits = [b for b in bits if not b.is_empty] + [owners[k]]
        u = shapely.union_all(bits, grid_size=0.02)
        p = biggest(u)
        cells.append(Polygon(p.exterior) if p is not None else owners[k])
    cells = list(shapely.coverage_simplify(cells, 1.2))
    cells = [biggest(shapely.make_valid(c)) or owners[i] for i, c in enumerate(cells)]

    # --------------------------------------------------------------- extents
    ext_ids = [e for e, _ in EXTENTS]

    def extent_of(geom):
        pt = geom.representative_point()
        for i, e in enumerate(ext_ids):
            if south_of[e].contains(pt):
                return i
        return None

    out_blocks = []
    for b, cell in zip(blocks, cells[: len(blocks)]):
        e = extent_of(b["outline"])
        if e is None:
            continue
        c = biggest(cell.intersection(south_of[ext_ids[e]]).union(b["outline"]))
        c = shapely.geometry.polygon.orient(Polygon(c.exterior), 1.0)
        lots_out = []
        for r in sorted(b["lots"], key=lambda r: r["lot"]):
            lg = shapely.geometry.polygon.orient(Polygon(r["geom"].exterior), 1.0)
            lots_out.append([flat(lg.exterior), r["bbl"], r["addr"], r["lu"]])
        out_blocks.append({"n": b["n"], "e": e, "c": flat(c.exterior), "o": flat(b["outline"].exterior),
                           "l": lots_out})
    out_parks = []
    for p, cell in zip(parks, cells[len(blocks):]):
        e = extent_of(p["outline"])
        if e is None:
            continue
        c = biggest(cell.intersection(south_of[ext_ids[e]]).union(p["outline"]))
        c = shapely.geometry.polygon.orient(Polygon(c.exterior), 1.0)
        out_parks.append({"name": p["name"], "e": e, "o": flat(p["outline"].exterior), "c": flat(c.exterior)})

    # The shoreline dataset stops at the bulkhead, but the piers are tax lots
    # too (Pier 40, Chelsea Piers, the Seaport): the land is the shore plus
    # every block and park standing past it.
    ground = shapely.union_all([land] + [b["outline"].buffer(1.5, join_style="mitre") for b in blocks]
                               + [p["outline"].buffer(1.5, join_style="mitre") for p in parks], grid_size=0.05)
    coasts = {}
    for e in ext_ids:
        g = biggest(ground.intersection(south_of[e]))
        g = shapely.geometry.polygon.orient(Polygon(g.exterior).simplify(1.5), 1.0)
        coasts[e] = flat(g.exterior)

    corr = []
    for name in sorted(set(CORRIDORS)):
        segs = [g for g, r in by_label.get(name, []) if r.get("rw_type") == "1"]
        widths = sorted(float(r["streetwidth"]) for g, r in by_label.get(name, [])
                        if r.get("rw_type") == "1" and r.get("streetwidth"))
        # curb-to-curb roadway width, feet -> metres (CSCL `streetwidth`)
        w = round(widths[len(widths) // 2] * 0.3048, 1) if widths else 12.0
        lines = []
        for g in segs:
            lines += list(getattr(g, "geoms", [g]))
        if not lines:
            continue
        m = linemerge(lines)
        for ln in getattr(m, "geoms", [m]):
            ln = ln.simplify(2.0)
            if ln.length < 60 or not top.intersects(ln):
                continue
            pts = []
            for x, y in ln.coords:
                pts += [round(x * 10), round(y * 10)]
            corr.append({"name": name, "w": w, "p": pts})

    # Every station complex, weighted by what it actually carries: one week of
    # 2024 ridership as a share of Times Square's. A complex with two entrances
    # is filed twice with two positions; both are kept, each at its own count.
    rid = json.load(open(os.path.join(RAW, "ridership.json")))
    peak = max(float(r["riders"]) for r in rid)
    stations = []
    for r in rid:
        x, y = xy(float(r["longitude"]), float(r["latitude"]))
        # a station on the cut street serves both sides of it (a complex
        # is filed at one point but its platforms run a block or more)
        e = next((i for i, ex in enumerate(ext_ids) if south_of[ex].distance(Point(x, y)) < 150), None)
        if e is None:
            continue
        nm = r["station_complex"]
        lines = " ".join(sorted(set(re.findall(r"\b([A-Z0-9])\b", " ".join(re.findall(r"\(([^)]*)\)", nm)).replace(",", " ")))))
        name = re.sub(r"\s*\([^)]*\)", "", nm).split("/")[0].strip()
        stations.append({"name": name, "lines": lines, "e": e, "x": round(x * 10), "y": round(y * 10),
                         "w": round(float(r["riders"]) / peak, 3)})
    stations.sort(key=lambda s: -s["w"])

    data = {
        "source": "NYC DCP MapPLUTO; NYC Open Data gthc-hcne, enfh-gkve, inkn-q76z; data.ny.gov wujg-7c2s. Baked by pipeline/manhattan/bake.py.",
        "center": list(CENTER), "unit": 0.1,
        "extents": ext_ids, "coast": coasts,
        "blocks": out_blocks, "parks": out_parks, "corridors": corr, "stations": stations,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    n_lots = defaultdict(int)
    for b in out_blocks:
        for i in range(b["e"], len(ext_ids)):
            n_lots[ext_ids[i]] += len(b["l"])
    print("lots by extent:", dict(n_lots))
    print("wrote", OUT, os.path.getsize(OUT) // 1024, "KB")


if __name__ == "__main__":
    main()
