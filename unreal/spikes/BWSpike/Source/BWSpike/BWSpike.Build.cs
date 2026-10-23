using UnrealBuildTool;
public class BWSpike : ModuleRules
{
	public BWSpike(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine", "Slate", "SlateCore", "WebBrowser", "WebSockets", "Json", "ImageCore" });
	}
}
