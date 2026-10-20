# Dependency closure of named City Sample assets (materials for the ground,
# roofs, water...), in the same shape as kit-survey.py's output so
# migrate-kit.mjs can copy it.
#
#   UnrealEditor-Cmd.exe D:/Projects/CitySample/CitySample.uproject -run=pythonscript
#       -script="<this file> ground D:/out/kit-ground.json /Game/Road/Material/MI/M_Asphalt_Master_Inst ..."
import json, os, sys
import unreal

args = sys.argv[1:]
name, out, roots = args[0], args[1], args[2:]
reg = unreal.AssetRegistryHelpers.get_asset_registry()
reg.scan_paths_synchronous(["/Game"], True)
opts = unreal.AssetRegistryDependencyOptions(include_soft_package_references=False, include_hard_package_references=True,
                                             include_searchable_names=False, include_soft_management_references=False,
                                             include_hard_management_references=False)
seen, todo = set(), list(roots)
while todo:
    p = todo.pop()
    if p in seen or not p.startswith("/Game/"):
        continue
    seen.add(p)
    for d in reg.get_dependencies(p, opts) or []:
        d = str(d)
        if d not in seen and d.startswith("/Game/"):
            todo.append(d)
content = unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_content_dir())
files, total = [], 0
for p in sorted(seen):
    rel = p[len("/Game/"):]
    for ext in (".uasset", ".umap", ".uexp", ".ubulk"):
        f = os.path.join(content, rel + ext)
        if os.path.exists(f):
            total += os.path.getsize(f)
            files.append(rel + ext)
json.dump({"kit": name, "roots": roots, "pieces": [], "closure": sorted(seen), "files": files, "bytes": total}, open(out, "w"), indent=1)
unreal.log("CLOSURE %s: %d packages, %.1f MB -> %s" % (name, len(seen), total / 1e6, out))
