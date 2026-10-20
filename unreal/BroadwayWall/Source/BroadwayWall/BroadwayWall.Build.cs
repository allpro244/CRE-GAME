using UnrealBuildTool;
public class BroadwayWall : ModuleRules
{
	public BroadwayWall(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new string[] {
			"Core", "CoreUObject", "Engine", "InputCore", "Slate", "SlateCore",
			"Json", "ProceduralMeshComponent", "GeometryCore", "ImageCore" });
	}
}
