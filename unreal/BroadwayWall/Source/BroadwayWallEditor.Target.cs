using UnrealBuildTool;
public class BroadwayWallEditorTarget : TargetRules
{
	public BroadwayWallEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("BroadwayWall");
	}
}
