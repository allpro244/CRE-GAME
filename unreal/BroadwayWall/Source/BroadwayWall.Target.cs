using UnrealBuildTool;
public class BroadwayWallTarget : TargetRules
{
	public BroadwayWallTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("BroadwayWall");
	}
}
