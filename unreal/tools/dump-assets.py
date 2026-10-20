# Export named assets to T3D text (materials, material functions, data assets),
# so their parameters and per-instance-data usage can be read.
#   UnrealEditor-Cmd.exe <project> -run=pythonscript -script="<this> <outdir> /Game/A /Game/B ..."
import os, sys
import unreal

out, paths = sys.argv[1], sys.argv[2:]
os.makedirs(out, exist_ok=True)
reg = unreal.AssetRegistryHelpers.get_asset_registry()
reg.scan_paths_synchronous(sorted({p.rsplit("/", 1)[0] for p in paths}), True)
for p in paths:
    obj = unreal.EditorAssetLibrary.load_asset(p)
    if not obj:
        unreal.log_warning("DUMP missing " + p)
        continue
    name = p.rsplit("/", 1)[1]
    task = unreal.AssetExportTask()
    task.object = obj
    task.filename = os.path.join(out, name + ".t3d")
    task.automated = True
    task.prompt = False
    ok = unreal.Exporter.run_asset_export_task(task)
    if not ok:
        with open(os.path.join(out, name + ".txt"), "w") as f:
            f.write("class %s\n" % obj.get_class().get_name())
            for attr in sorted(dir(obj)):
                if attr.startswith("_"):
                    continue
                try:
                    f.write("%s = %r\n" % (attr, obj.get_editor_property(attr)))
                except Exception:
                    pass
    unreal.log("DUMP %s -> %s" % (p, "t3d" if ok else "txt"))
