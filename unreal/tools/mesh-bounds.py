# Print the bounding box of named static meshes (cm, mesh space), to place props.
#   UnrealEditor-Cmd.exe <project> -run=pythonscript -script="<this> <out.json> /Game/A /Game/B ..."
import json, sys
import unreal

out, paths = sys.argv[1], sys.argv[2:]
res = {}
for p in paths:
    m = unreal.EditorAssetLibrary.load_asset(p)
    if not isinstance(m, unreal.StaticMesh):
        res[p] = None
        continue
    b = m.get_bounding_box()
    res[p] = {"min": [b.min.x, b.min.y, b.min.z], "max": [b.max.x, b.max.y, b.max.z]}
with open(out, "w") as f:
    json.dump(res, f, indent=1)
unreal.log("BOUNDS %d meshes" % len(res))
