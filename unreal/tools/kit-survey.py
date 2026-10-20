# Survey a City Sample building kit, headless, from inside the City Sample project:
# every facade piece's bounds (the module grid the facade builder lays out on),
# and the full dependency closure (what migrating the kit really copies).
#
#   UnrealEditor-Cmd.exe D:/Projects/CitySample/CitySample.uproject -run=pythonscript
#       -script="<this file> CHF D:/out/kit-CHF.json" -unattended -nullrhi -nosplash
import json, os, sys
import unreal

args = sys.argv[1:] if len(sys.argv) > 1 else []
kit = args[0] if args else "CHF"                      # CHF -> /Game/Building/CH/F
out = args[1] if len(args) > 1 else "kit-%s.json" % kit
root = "/Game/Building/%s/%s" % (kit[:2], kit[2:])

reg = unreal.AssetRegistryHelpers.get_asset_registry()
assets = reg.get_assets_by_path(root, recursive=True)

pieces = []
for a in assets:
    name = str(a.asset_name)
    if str(a.asset_class_path.asset_name) != "StaticMesh" or not name.startswith("SM_") or name.lower().endswith("_decal"):
        continue
    mesh = unreal.EditorAssetLibrary.load_asset(str(a.package_name))
    b = mesh.get_bounds()
    o, e = b.origin, b.box_extent
    mats = [str(m.material_interface.get_path_name()) if m.material_interface else "" for m in mesh.static_materials]
    pieces.append({
        "name": name, "path": str(a.package_name),
        "min": [o.x - e.x, o.y - e.y, o.z - e.z], "max": [o.x + e.x, o.y + e.y, o.z + e.z],
        "materials": mats,
        "nanite": bool(mesh.get_editor_property("nanite_settings").enabled),
    })

# dependency closure of every package under the kit, hard references only
opts = unreal.AssetRegistryDependencyOptions(include_soft_package_references=False, include_hard_package_references=True,
                                             include_searchable_names=False, include_soft_management_references=False,
                                             include_hard_management_references=False)
seen, todo = set(), [str(a.package_name) for a in assets]
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
total, files = 0, []
for p in sorted(seen):
    rel = p[len("/Game/"):]
    for ext in (".uasset", ".umap", ".uexp", ".ubulk"):
        f = os.path.join(content, rel + ext)
        if os.path.exists(f):
            total += os.path.getsize(f)
            files.append(rel + ext)

json.dump({"kit": kit, "root": root, "pieces": sorted(pieces, key=lambda x: x["name"]),
           "closure": sorted(seen), "files": files, "bytes": total}, open(out, "w"), indent=1)
unreal.log("KIT %s: %d pieces, %d packages in closure, %.1f MB -> %s" % (kit, len(pieces), len(seen), total / 1e6, out))
