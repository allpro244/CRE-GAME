# Export City Sample's shape-grammar data for one kit (RULE_<kit>_Lnn, SGD_<kit>_A)
# to text, so the facade builder can follow how Epic stacks the floor bands.
#
#   UnrealEditor-Cmd.exe D:/Projects/CitySample/CitySample.uproject -run=pythonscript
#       -script="<this file> CHF D:/out/grammar-CHF" -unattended -nullrhi -nosplash
import os, sys
import unreal

args = sys.argv[1:]
kit = args[0] if args else "CHF"
out = args[1] if len(args) > 1 else "grammar-%s" % kit
os.makedirs(out, exist_ok=True)
root = "/CitySamplePCG/PCG/DataAssets/Buildings/%s" % kit

reg = unreal.AssetRegistryHelpers.get_asset_registry()
# commandlets scan plugin content lazily: ask for this folder now
reg.scan_paths_synchronous([root], True)
n = 0
for a in reg.get_assets_by_path(root, recursive=True):
    obj = unreal.EditorAssetLibrary.load_asset(str(a.package_name))
    task = unreal.AssetExportTask()
    task.object = obj
    task.filename = os.path.join(out, str(a.asset_name) + ".t3d")
    task.automated = True
    task.prompt = False
    task.replace_identical = True
    task.exporter = None
    ok = unreal.Exporter.run_asset_export_task(task)
    if not ok:
        # no T3D exporter for this class: fall back to the reflected properties python can see
        with open(os.path.join(out, str(a.asset_name) + ".txt"), "w") as f:
            f.write("class %s\n" % obj.get_class().get_name())
            for attr in sorted(dir(obj)):
                if attr.startswith("_"):
                    continue
                try:
                    v = obj.get_editor_property(attr)
                except Exception:
                    continue
                f.write("%s = %r\n" % (attr, v))
    n += 1
unreal.log("GRAMMAR %s: %d assets -> %s" % (kit, n, out))
