using UnrealBuildTool;
public class BWSpikeEditorTarget : TargetRules
{
	public BWSpikeEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("BWSpike");
	}
}
