// The Phase 1 shell: an RTS camera over the city, click a building to name it.
//
//   WASD / arrows   pan          Q / E         rotate
//   mouse wheel     zoom         right-drag    orbit
//   left click      select a parcel (its card shows top left)
//
// Command line:
//   -City=<path>      a bw-city/1 file (default: Data/city-1-metro.json)
//   -Shots=<dir>      fly a fixed set of cameras, save a PNG at each, then quit
//   -Sim=<ws://...>   drive the city from the engine sidecar (unreal/sim-server):
//                     autoplay -Years=N (default 20); with -Shots, capture the
//                     skyline at years 0, 5, 10, 20 from one camera
#pragma once

#include "GameFramework/GameModeBase.h"
#include "GameFramework/HUD.h"
#include "GameFramework/Pawn.h"
#include "GameFramework/PlayerController.h"
#include "BWGame.generated.h"

class ACityBuilder;
class IWebSocket;
class UCameraComponent;
struct FBWParcel;

UCLASS()
class ABWCameraPawn : public APawn
{
	GENERATED_BODY()
public:
	ABWCameraPawn();
	virtual void Tick(float Dt) override;

	/** Ground point the camera looks at, and how it looks at it. */
	FVector Focus = FVector::ZeroVector;
	double Yaw = 0, Pitch = -45, Distance = 150000;
	double MinDistance = 3000, MaxDistance = 600000;

	void Pan(const FVector2D& Dir, double Dt);
	void Zoom(double Steps);
	void SetView(const FVector& InFocus, double InYaw, double InPitch, double InDistance);

	UPROPERTY(VisibleAnywhere)
	TObjectPtr<UCameraComponent> Camera;
};

UCLASS()
class ABWPlayerController : public APlayerController
{
	GENERATED_BODY()
public:
	ABWPlayerController();
	virtual void PlayerTick(float Dt) override;

	/** Select whatever parcel is under this screen point; returns it or null. */
	const FBWParcel* PickAt(const FVector2D& ScreenPos);
	void Select(const FBWParcel* P);

	const FBWParcel* Selected = nullptr;
	TWeakObjectPtr<ACityBuilder> City;
};

UCLASS()
class ABWHUD : public AHUD
{
	GENERATED_BODY()
public:
	virtual void DrawHUD() override;
};

UCLASS()
class ABWGameMode : public AGameModeBase
{
	GENERATED_BODY()
public:
	ABWGameMode();
	virtual void BeginPlay() override;

	UPROPERTY()
	TObjectPtr<ACityBuilder> City;

	/** Live economy state for the HUD. */
	int32 SimMonth = -1, SimYear = 0;
	FString SimPhase;
	int32 SimFrames = 0;

private:
	void SpawnSky();
	void StartSim(const FString& Url);
	void OnSimMessage(const FString& Msg);
	TSharedPtr<IWebSocket> Sim;
	int32 SimYears = 20;
	FString ShotDir;
	double SimStarted = 0;
	void RunShots(const FString& Dir);
	void SaveWindowShot(const FString& Path);
};
