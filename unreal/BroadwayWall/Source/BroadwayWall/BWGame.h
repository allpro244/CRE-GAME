// The Phase 1 shell: an RTS camera over the city, click a building to name it.
//
//   WASD / arrows   pan          Q / E         rotate
//   mouse wheel     zoom         right-drag    orbit
//   left click      select a parcel (its card shows top left)
//   1 / 2 / 3       strategy / drone flyover / street-level walk
//
// Command line:
//   -City=<path>      a bw-city/1 file (default: Data/city-1-metro.json)
//   -Shots=<dir>      fly a fixed set of cameras, save a PNG at each, then quit
//   -Play             the real game: the web desks over the 3D city (PlayHost.h)
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
class SWebBrowser;
class UBWBridge;
class IWebSocket;
class UCameraComponent;
class UAudioComponent;
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

	/** Phase 4 camera modes: 1 strategy (orbit a focus), 2 drone (a slow circling
	 *  flyover), 3 street (eye height, walk with WASD, look with right-drag). */
	enum class EMode : uint8 { Strategy, Drone, Street };
	EMode Mode = EMode::Strategy;
	void SetMode(EMode M);
	double DroneT = 0;

	void Pan(const FVector2D& Dir, double Dt);
	void Zoom(double Steps);
	void SetView(const FVector& InFocus, double InYaw, double InPitch, double InDistance);

	UPROPERTY(VisibleAnywhere)
	TObjectPtr<UCameraComponent> Camera;

	/** Phase 4 sound: a city bed that crossfades from street wash to high air with
	 *  altitude, and a jackhammer that sits on the nearest site going up. */
	UPROPERTY()
	TObjectPtr<UAudioComponent> StreetBed;
	UPROPERTY()
	TObjectPtr<UAudioComponent> AirBed;
	UPROPERTY()
	TObjectPtr<UAudioComponent> Site;
	virtual void BeginPlay() override;
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

	/** Play mode: the page owns the mouse and keyboard and forwards them here. */
	TSet<FString> PageKeys;
	/** Phase 5 map HUD: the lot under the pointer (page-forwarded in play mode), refreshed ~10x a second. */
	const FBWParcel* Hovered = nullptr;
	FVector2D HoverPx = FVector2D(-1, -1);
	double HoverClock = 0;
	void PageInput(const FString& Type, double X, double Y, double Dx, double Dy, double Wheel, const FString& Key);
	/** Called when the player picks a lot in 3D (play mode tells the page). */
	TFunction<void(const FBWParcel*)> OnPicked;
	/** Select without telling anyone (the page asked for it). */
	void ShowSelected(const FBWParcel* P);
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

	// play mode: the page's calls, via UBWBridge
	void OnPageCity(const FString& Json);
	void OnPageView(const FString& Json);
	void OnPageSelect(const FString& Bbl);
	void OnPageInput(const FString& Json);

	/** The sun follows the game calendar: low and cool in winter, high and warm in summer. */
	void SetSeason(int32 Month);

private:
	UPROPERTY()
	TObjectPtr<class ADirectionalLight> Sun;
	// not StartPlay: that name is AGameModeBase's own virtual (it begins play)
	void StartPlayHost();
	TSharedPtr<SWebBrowser> Browser;
	UPROPERTY()
	TObjectPtr<UBWBridge> Bridge;
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
