// Play mode (-Play): the real game, end to end, inside Unreal (UE58_PLAN.md
// §2, host A). The web game runs in a full-window transparent browser over the
// 3D city — engine, saves and desks exactly as in a browser, served by Unreal's
// own HTTP server from the committed playable — and talks to the city through
// UBWBridge (the page's end is broadway-and-wall/src/state/unrealHost.ts):
//
//   page -> Unreal   city(bw-city/1)  view(bw-render/1)  select(bbl)  input(pointer/keys)
//   Unreal -> page   window.bwUnreal.select(bbl)  when a building is clicked in 3D
#pragma once

#include "CoreMinimal.h"
#include "UObject/Object.h"
#include "PlayHost.generated.h"

class ABWGameMode;
class SWebBrowser;

/** Bound into the page as window.ue.bridge. */
UCLASS()
class UBWBridge : public UObject
{
	GENERATED_BODY()
public:
	UFUNCTION() void City(const FString& Json);
	UFUNCTION() void View(const FString& Json);
	UFUNCTION() void Select(const FString& Bbl);
	UFUNCTION() void Input(const FString& Json);

	TWeakObjectPtr<ABWGameMode> Game;
};

/** Serves a folder over http://127.0.0.1:<port>/ (saves need a real origin; file:// has none). */
struct FBWWebServer
{
	static bool Start(const FString& Root, uint32 Port);
};
