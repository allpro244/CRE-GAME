"""Fetch the public sources the real Manhattan plat is baked from.

    python3 pipeline/manhattan/fetch.py [rawdir]

Everything is public and keyless:
  * MapPLUTO tax lots (NYC Department of City Planning's ArcGIS feature
    service) -- one polygon per tax lot, with block, lot, address, land use.
  * Borough Boundaries, clipped to shoreline (NYC Open Data gthc-hcne).
  * Parks Properties (NYC Open Data enfh-gkve) -- names for the green lots.
  * MTA subway ridership by station complex (data.ny.gov wujg-7c2s), one
    ordinary autumn week of 2024, with each complex's position.
  * Street centerlines, CSCL (NYC Open Data inkn-q76z) -- real street names
    and widths for the avenues and crosstown corridors.

Writes raw GeoJSON into `rawdir` (default pipeline/manhattan/raw, gitignored).
Then run bake.py, which needs shapely.
"""
import json, os, sys, time, urllib.request, urllib.parse

ROOT = os.path.dirname(os.path.abspath(__file__))
RAW = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "raw")
os.makedirs(RAW, exist_ok=True)

PLUTO = "https://services5.arcgis.com/GfwWNkhOj9bNBqoJ/arcgis/rest/services/MAPPLUTO/FeatureServer/0/query"
FIELDS = "BBL,Block,Lot,Address,LandUse,BldgClass,LotArea,NumFloors,YearBuilt,OwnerType"


def get(url, tries=4):
    for k in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                return r.read()
        except Exception as e:  # network flake: back off and retry
            if k == tries - 1:
                raise
            time.sleep(2 ** (k + 1))


def fetch_pluto():
    feats, offset = [], 0
    while True:
        q = urllib.parse.urlencode({
            "where": "Borough='MN'", "outFields": FIELDS, "outSR": 4326,
            "geometryPrecision": 6, "orderByFields": "OBJECTID",
            "resultOffset": offset, "resultRecordCount": 2000, "f": "geojson",
        })
        page = json.loads(get(PLUTO + "?" + q))
        feats += page["features"]
        print(f"  pluto {len(feats)}", flush=True)
        if len(page["features"]) < 2000:
            break
        offset += 2000
    return {"type": "FeatureCollection", "features": feats}


def save(name, obj):
    with open(os.path.join(RAW, name), "w") as f:
        json.dump(obj, f)


if __name__ == "__main__":
    save("pluto.geojson", fetch_pluto())
    save("boro.geojson", json.loads(get(
        "https://data.cityofnewyork.us/resource/gthc-hcne.geojson?boroname=Manhattan")))
    save("parks.geojson", json.loads(get(
        "https://data.cityofnewyork.us/resource/enfh-gkve.geojson?borough=M&$limit=5000")))
    # Socrata aggregates a week in about three minutes; a year times out.
    rq = urllib.parse.urlencode({
        "$select": "station_complex_id,station_complex,latitude,longitude,sum(ridership) as riders",
        "$where": "transit_timestamp between '2024-10-07T00:00:00' and '2024-10-13T23:59:59' AND borough='Manhattan'",
        "$group": "station_complex_id,station_complex,latitude,longitude", "$limit": 5000})
    save("ridership.json", json.loads(get("https://data.ny.gov/resource/wujg-7c2s.json?" + rq)))
    q = urllib.parse.urlencode({"$where": "boroughcode='1'", "$limit": 50000,
        "$select": "the_geom,full_street_name,stname_label,streetwidth,rw_type,l_low_hn,l_high_hn,r_low_hn,r_high_hn"})
    save("centerline.json", json.loads(get("https://data.cityofnewyork.us/resource/inkn-q76z.json?" + q)))
    print("done ->", RAW)
