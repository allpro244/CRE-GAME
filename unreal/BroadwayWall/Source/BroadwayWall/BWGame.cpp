#include "BWGame.h"

#include "Camera/CameraComponent.h"
#include "Components/AudioComponent.h"
#include "Sound/SoundWave.h"
#include "CityBuilder.h"
#include "CityLife.h"
#include "EngineUtils.h"
#include "Components/DirectionalLightComponent.h"
#include "Components/SkyLightComponent.h"
#include "DrawDebugHelpers.h"
#include "Engine/Canvas.h"
#include "Engine/DirectionalLight.h"
#include "Engine/Engine.h"
#include "Engine/ExponentialHeightFog.h"
#include "Engine/PostProcessVolume.h"
#include "Components/VolumetricCloudComponent.h"
#include "Components/ExponentialHeightFogComponent.h"
#include "Engine/Font.h"
#include "Engine/GameViewportClient.h"
#include "Engine/SkyLight.h"
#include "Engine/TextureCube.h"
#include "Components/SkyAtmosphereComponent.h"
#include "Framework/Application/SlateApplication.h"
#include "ImageCore.h"
#include "ImageUtils.h"
#include "Misc/CommandLine.h"
#include "Misc/FileHelper.h"
#include "Misc/Parse.h"
#include "Misc/Paths.h"
#include "TimerManager.h"
#include "Widgets/SWindow.h"
#include "ContentStreaming.h"
#if WITH_EDITOR
#include "ShaderCompiler.h"
#include "AssetCompilingManager.h"
#endif
#include "IWebSocket.h"
#include "WebSocketsModule.h"
#include "RenderView.h"
#include "PlayHost.h"
#include "Scalability.h"
#include "SWebBrowser.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

DEFINE_LOG_CATEGORY_STATIC(LogBW, Log, All);

// ---------------------------------------------------------------- camera

ABWCameraPawn::ABWCameraPawn()
{
	PrimaryActorTick.bCanEverTick = true;
	Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
	RootComponent = Camera;
	Camera->SetFieldOfView(50);
}

void ABWCameraPawn::BeginPlay()
{
	Super::BeginPlay();
	if (FParse::Param(FCommandLine::Get(), TEXT("NoSound"))) return;
	auto Loop = [this](const TCHAR* Path, const TCHAR* Name, bool bSpatial) -> UAudioComponent*
	{
		USoundWave* W = LoadObject<USoundWave>(nullptr, Path);
		if (!W) return nullptr;
		W->bLooping = true;
		UAudioComponent* A = NewObject<UAudioComponent>(this, Name);
		A->SetupAttachment(bSpatial ? nullptr : RootComponent.Get());
		A->SetSound(W);
		A->bAllowSpatialization = bSpatial;
		A->bAutoActivate = false;
		A->RegisterComponent();
		A->Play();
		return A;
	};
	StreetBed = Loop(TEXT("/Game/Audio/SoundWaves/Ambient/Air_Traffic/sfx_LeaveBehind_amb_Traffic_GroundLevel_Wash_lp_01.sfx_LeaveBehind_amb_Traffic_GroundLevel_Wash_lp_01"), TEXT("StreetBed"), false);
	AirBed = Loop(TEXT("/Game/Audio/SoundWaves/Ambient/Air_Traffic/sfx_LeaveBehind_amb_Urban_Air_Wide_lp_01.sfx_LeaveBehind_amb_Urban_Air_Wide_lp_01"), TEXT("AirBed"), false);
	Site = Loop(TEXT("/Game/Audio/SoundWaves/Ambient/Misc/sfx_LeaveBehind_amb_Swt_Jackhammer_Close_nl_01.sfx_LeaveBehind_amb_Swt_Jackhammer_Close_nl_01"), TEXT("Site"), true);
}

void ABWCameraPawn::Tick(float Dt)
{
	Super::Tick(Dt);
	// the bed follows altitude: street wash at eye height, wide air from a drone
	const double Alt = Mode == EMode::Street ? 170.0 : FMath::Max(170.0, GetActorLocation().Z);
	const float Up = FMath::Clamp(float((Alt - 1500.0) / 40000.0), 0.f, 1.f);
	if (StreetBed) StreetBed->SetVolumeMultiplier(0.9f * (1.f - Up) + 0.05f);
	if (AirBed) AirBed->SetVolumeMultiplier(0.25f + 0.6f * Up);
	if (Site)
	{
		// the nearest frame going up, if any; heard within ~150 m
		FVector Best(0), Me = GetActorLocation();
		double BestD = 1e18;
		if (const ABWGameMode* GM = GetWorld()->GetAuthGameMode<ABWGameMode>(); GM && GM->City)
			for (const FVector& S : GM->City->GetSites()) { const double D = FVector::DistSquared2D(S, Me); if (D < BestD) { BestD = D; Best = S; } }
		const double Dist = FMath::Sqrt(BestD) + FMath::Max(0.0, Me.Z - 500.0) * 0.5;
		Site->SetWorldLocation(FVector(Best.X, Best.Y, 300));
		Site->SetVolumeMultiplier(BestD < 1e17 ? FMath::Clamp(float(1.0 - Dist / 15000.0), 0.f, 1.f) : 0.f);
	}
	if (Mode == EMode::Street)
	{
		// a pedestrian: eye height on the ground plane, looking where they like
		Pitch = FMath::Clamp(Pitch, -60.0, 60.0);
		const FRotator Rot(Pitch, Yaw, 0);
		SetActorLocationAndRotation(FVector(Focus.X, Focus.Y, 170), Rot);
		return;
	}
	if (Mode == EMode::Drone)
	{
		// a slow helicopter circle, drifting in and out over the focus
		DroneT += Dt;
		Yaw += 3.0 * Dt;
		Pitch = -18 - 6 * FMath::Sin(DroneT * 0.07);
	}
	Pitch = FMath::Clamp(Pitch, -89.0, -8.0);
	Distance = FMath::Clamp(Distance, MinDistance, MaxDistance);
	const FRotator Rot(Pitch, Yaw, 0);
	SetActorLocationAndRotation(Focus - Rot.Vector() * Distance, Rot);
}

void ABWCameraPawn::SetMode(EMode M)
{
	if (M == Mode) return;
	if (M == EMode::Street) { Focus = Focus - FRotator(0, Yaw, 0).Vector() * 3000; Pitch = 4; } // step back from what you were looking at
	if (M == EMode::Drone) { Distance = FMath::Max(Distance, 60000.0); DroneT = 0; }
	if (M == EMode::Strategy && Mode == EMode::Street) { Pitch = -40; Distance = 30000; }
	Mode = M;
}

void ABWCameraPawn::Pan(const FVector2D& Dir, double Dt)
{
	// faster when high up: a screen's width a second-ish; a brisk walk at street level
	const double Speed = Mode == EMode::Street ? 450.0 : Distance * 0.9;
	const FRotator Flat(0, Yaw, 0);
	Focus += (Flat.Vector() * Dir.Y + FRotationMatrix(Flat).GetUnitAxis(EAxis::Y) * Dir.X) * Speed * Dt;
}

void ABWCameraPawn::Zoom(double Steps)
{
	Distance *= FMath::Pow(0.85, Steps);
}

void ABWCameraPawn::SetView(const FVector& InFocus, double InYaw, double InPitch, double InDistance)
{
	Focus = InFocus; Yaw = InYaw; Pitch = InPitch; Distance = InDistance;
	Tick(0);
}

// ---------------------------------------------------------------- controller

ABWPlayerController::ABWPlayerController()
{
	bShowMouseCursor = true;
	bEnableClickEvents = false;
	DefaultMouseCursor = EMouseCursor::Default;
}

void ABWPlayerController::PlayerTick(float Dt)
{
	Super::PlayerTick(Dt);
	ABWCameraPawn* Cam = Cast<ABWCameraPawn>(GetPawn());
	if (!Cam) return;

	auto Down = [this](const FKey& K, const TCHAR* Code) { return IsInputKeyDown(K) || PageKeys.Contains(Code); };
	FVector2D Dir(0, 0);
	if (Down(EKeys::W, TEXT("KeyW")) || IsInputKeyDown(EKeys::Up)) Dir.Y += 1;
	if (Down(EKeys::S, TEXT("KeyS")) || IsInputKeyDown(EKeys::Down)) Dir.Y -= 1;
	if (Down(EKeys::D, TEXT("KeyD")) || IsInputKeyDown(EKeys::Right)) Dir.X += 1;
	if (Down(EKeys::A, TEXT("KeyA")) || IsInputKeyDown(EKeys::Left)) Dir.X -= 1;
	if (!Dir.IsZero()) Cam->Pan(Dir.GetSafeNormal(), Dt);
	if (WasInputKeyJustPressed(EKeys::One)) Cam->SetMode(ABWCameraPawn::EMode::Strategy);
	if (WasInputKeyJustPressed(EKeys::Two)) Cam->SetMode(ABWCameraPawn::EMode::Drone);
	if (WasInputKeyJustPressed(EKeys::Three)) Cam->SetMode(ABWCameraPawn::EMode::Street);
	if (Down(EKeys::Q, TEXT("KeyQ"))) Cam->Yaw -= 70 * Dt;
	if (Down(EKeys::E, TEXT("KeyE"))) Cam->Yaw += 70 * Dt;
	if (WasInputKeyJustPressed(EKeys::MouseScrollUp)) Cam->Zoom(1);
	if (WasInputKeyJustPressed(EKeys::MouseScrollDown)) Cam->Zoom(-1);

	if (IsInputKeyDown(EKeys::RightMouseButton))
	{
		float Dx, Dy;
		GetInputMouseDelta(Dx, Dy);
		Cam->Yaw += Dx * 0.25;
		Cam->Pitch += Dy * 0.25;
	}
	// hover card: own mouse when Unreal has it, the page's when it forwards it
	{
		float MX, MY;
		if (GetMousePosition(MX, MY)) HoverPx = FVector2D(MX, MY);
		HoverClock += Dt;
		if (HoverClock > 0.1 && HoverPx.X >= 0) { HoverClock = 0; Hovered = PickAt(HoverPx); }
	}
	if (WasInputKeyJustPressed(EKeys::LeftMouseButton))
	{
		float X, Y;
		if (GetMousePosition(X, Y)) { Select(PickAt(FVector2D(X, Y))); if (OnPicked) OnPicked(Selected); }
	}
}

void ABWPlayerController::PageInput(const FString& Type, double X, double Y, double Dx, double Dy, double Wheel, const FString& Key)
{
	ABWCameraPawn* Cam = Cast<ABWCameraPawn>(GetPawn());
	if (!Cam) return;
	int32 W = 1, H = 1;
	GetViewportSize(W, H);
	if (Type == TEXT("kd") && Key == TEXT("Digit1")) Cam->SetMode(ABWCameraPawn::EMode::Strategy);
	else if (Type == TEXT("kd") && Key == TEXT("Digit2")) Cam->SetMode(ABWCameraPawn::EMode::Drone);
	else if (Type == TEXT("kd") && Key == TEXT("Digit3")) Cam->SetMode(ABWCameraPawn::EMode::Street);
	else if (Type == TEXT("kd")) PageKeys.Add(Key);
	else if (Type == TEXT("ku")) PageKeys.Remove(Key);
	else if (Type == TEXT("hover")) HoverPx = FVector2D(X * W, Y * H);
	else if (Type == TEXT("quality"))
	{
		// GRAPHICS (Phase 6), from the game's own Settings page. Measured on the
		// metro city at 1440p, RTX 2080: full resolution ~41 fps, half ~55. High is
		// native Epic; medium renders at 67% and upscales (TSR); low at 50% with
		// High scalability. Resolution is the lever; everything else stays photoreal.
		Scalability::FQualityLevels Q = Scalability::GetQualityLevels();
		const bool bLow = Key == TEXT("low"), bMed = Key == TEXT("medium");
		Q.SetFromSingleQualityLevel(bLow ? 2 : 3);
		Scalability::SetQualityLevels(Q);
		// DLSS when the NVIDIA plugin is present and the GPU supports it (RTX): high is
		// DLAA (native resolution, DLSS anti-aliasing), medium DLSS Quality (67%), low
		// DLSS Performance (50%). Otherwise the same resolutions through TSR.
		IConsoleVariable* Dlss = IConsoleManager::Get().FindConsoleVariable(TEXT("r.NGX.DLSS.Enable"));
		if (Dlss && !FParse::Param(FCommandLine::Get(), TEXT("NoDLSS"))) Dlss->Set(1);
		if (IConsoleVariable* SP = IConsoleManager::Get().FindConsoleVariable(TEXT("r.ScreenPercentage"))) SP->Set(bLow ? 50.f : bMed ? 67.f : 100.f);
		UE_LOG(LogBW, Display, TEXT("QUALITY %s (%s)"), *Key, Dlss && Dlss->GetInt() ? TEXT("DLSS") : TEXT("TSR"));
	}
	else if (Type == TEXT("zoom")) Cam->Zoom(Wheel);
	else if (Type == TEXT("orbit")) { Cam->Yaw += Dx * 0.25; Cam->Pitch += (Cam->Mode == ABWCameraPawn::EMode::Street ? -1 : -1) * Dy * 0.25; }
	else if (Type == TEXT("pan"))
	{
		// drag the ground: a screen width of drag moves about a view width of city
		const double PerPx = Cam->Distance * 1.1 / FMath::Max(W, 1);
		const FRotator Flat(0, Cam->Yaw, 0);
		Cam->Focus -= (FRotationMatrix(Flat).GetUnitAxis(EAxis::Y) * Dx - Flat.Vector() * Dy) * PerPx;
	}
	else if (Type == TEXT("click"))
	{
		Select(PickAt(FVector2D(X * W, Y * H)));
		if (OnPicked) OnPicked(Selected);
	}
}

void ABWPlayerController::ShowSelected(const FBWParcel* P)
{
	if (P != Selected) Select(P);
}

const FBWParcel* ABWPlayerController::PickAt(const FVector2D& ScreenPos)
{
	if (!City.IsValid()) return nullptr;
	FHitResult Hit;
	FCollisionQueryParams Q(TEXT("BWPick"), true);
	Q.bReturnFaceIndex = true;
	FVector Origin, Dir;
	if (!DeprojectScreenPositionToWorld(ScreenPos.X, ScreenPos.Y, Origin, Dir)) return nullptr;
	if (!GetWorld()->LineTraceSingleByChannel(Hit, Origin, Origin + Dir * 2000000, ECC_Visibility, Q)) return nullptr;
	return City->ParcelFromHit(Hit);
}

void ABWPlayerController::Select(const FBWParcel* P)
{
	Selected = P;
	FlushPersistentDebugLines(GetWorld());
	if (!P || !City.IsValid()) return;
	UE_LOG(LogBW, Display, TEXT("PICK %s  %s  (%s, %d fl, top %.0f m)"), *P->Bbl, *P->Address, *P->Cls, P->Floors, City->ParcelTop(P->Bbl) / 100.0);
	const double Z = City->ParcelTop(P->Bbl) + 60;
	for (int32 i = 0, n = P->Ring.Num(); i < n; ++i)
	{
		const FVector2D A = P->Ring[i], B = P->Ring[(i + 1) % n];
		DrawDebugLine(GetWorld(), FVector(A.X, A.Y, Z), FVector(B.X, B.Y, Z), FColor(255, 214, 64), true, -1, 0, 120);
		DrawDebugLine(GetWorld(), FVector(A.X, A.Y, 40), FVector(B.X, B.Y, 40), FColor(255, 214, 64), true, -1, 0, 120);
		DrawDebugLine(GetWorld(), FVector(A.X, A.Y, 40), FVector(A.X, A.Y, Z), FColor(255, 214, 64), true, -1, 0, 80);
	}
}

// ---------------------------------------------------------------- HUD

void ABWHUD::DrawHUD()
{
	Super::DrawHUD();
	const ABWGameMode* GM = GetWorld()->GetAuthGameMode<ABWGameMode>();
	const ABWPlayerController* PC = Cast<ABWPlayerController>(GetOwningPlayerController());
	if (!GM || !GM->City || !PC) return;
	UFont* Font = GEngine->GetMediumFont();
	const float S = Canvas->ClipY / 900.f;

	auto Panel = [&](float X, float Y, float W, float H)
	{
		FCanvasTileItem Bg(FVector2D(X, Y), FVector2D(W, H), FLinearColor(0.04f, 0.06f, 0.09f, 0.82f));
		Bg.BlendMode = SE_BLEND_Translucent;
		Canvas->DrawItem(Bg);
	};
	auto Text = [&](const FString& T, float X, float Y, float Scale, const FLinearColor& C)
	{
		FCanvasTextItem It(FVector2D(X, Y), FText::FromString(T), Font, C);
		It.Scale = FVector2D(Scale * S);
		Canvas->DrawItem(It);
	};

	const FBWCity& C = GM->City->GetCity();
	Panel(16 * S, 16 * S, (GM->SimMonth >= 0 ? 440 : 300) * S, 34 * S);
	Text(GM->SimMonth >= 0
		? FString::Printf(TEXT("%s  ·  %d  ·  %s  ·  %d cranes"), *C.Name, GM->SimYear, *GM->SimPhase, GM->SimFrames)
		: FString::Printf(TEXT("%s  ·  %d lots"), *C.Name, C.Parcels.Num()), 28 * S, 22 * S, 1.2f, FLinearColor::White);

	// MAP HUD (Phase 5): a small native card beside the pointer, at frame rate
	if (const FBWParcel* P = PC->Hovered; P && P != PC->Selected && PC->HoverPx.X >= 0)
	{
		const FString Own = GM->City->OwnerOf(P->Bbl);
		const FString Line2 = P->Cls == TEXT("land") ? TEXT("vacant lot") : FString::Printf(TEXT("%s · %d fl · %d"), *P->Cls, P->Floors, P->YearBuilt);
		const FString Line3 = Own == TEXT("player") ? TEXT("yours") : Own.IsEmpty() ? TEXT("") : TEXT("rival: ") + Own;
		const float X = PC->HoverPx.X + 18 * S, Y = PC->HoverPx.Y + 14 * S;
		Panel(X, Y, 230 * S, (Line3.IsEmpty() ? 52 : 74) * S);
		Text(P->Address, X + 10 * S, Y + 6 * S, 1.05f, FLinearColor::White);
		Text(Line2, X + 10 * S, Y + 28 * S, 0.9f, FLinearColor(0.75f, 0.78f, 0.82f));
		if (!Line3.IsEmpty()) Text(Line3, X + 10 * S, Y + 50 * S, 0.9f, Own == TEXT("player") ? FLinearColor(1.f, 0.84f, 0.25f) : FLinearColor(0.85f, 0.55f, 0.45f));
	}
	if (const FBWParcel* P = PC->Selected)
	{
		const float X = 16 * S, Y = 58 * S;
		Panel(X, Y, 300 * S, 132 * S);
		Text(P->Address, X + 12 * S, Y + 8 * S, 1.35f, FLinearColor(1.f, 0.84f, 0.25f));
		Text(FString::Printf(TEXT("%s  ·  %s"), *P->DistrictName, *P->Zone), X + 12 * S, Y + 34 * S, 1.f, FLinearColor(0.75f, 0.78f, 0.82f));
		const FString Use = P->Cls == TEXT("land") ? TEXT("vacant lot") : FString::Printf(TEXT("%s  ·  %d fl  ·  %d"), *P->Cls, P->Floors, P->YearBuilt);
		Text(Use, X + 12 * S, Y + 58 * S, 1.f, FLinearColor::White);
		Text(FString::Printf(TEXT("lot %s sf  ·  bldg %s sf"), *FText::AsNumber(FMath::RoundToInt(P->LotArea)).ToString(),
			*FText::AsNumber(FMath::RoundToInt(P->BldgArea)).ToString()), X + 12 * S, Y + 82 * S, 1.f, FLinearColor::White);
		Text(TEXT("BBL ") + P->Bbl, X + 12 * S, Y + 106 * S, 0.9f, FLinearColor(0.55f, 0.58f, 0.62f));
	}
}

// ---------------------------------------------------------------- game mode

ABWGameMode::ABWGameMode()
{
	DefaultPawnClass = ABWCameraPawn::StaticClass();
	PlayerControllerClass = ABWPlayerController::StaticClass();
	HUDClass = ABWHUD::StaticClass();
}

void ABWGameMode::SpawnSky()
{
	UWorld* W = GetWorld();
	// Lights are configured before they register (deferred spawn): mobility and
	// real-time capture set on a registered component never reached the renderer,
	// which is why the shade side of every street was black.
	// Late afternoon from the west-southwest: long raking light, as in the reference skyline.
	Sun = W->SpawnActorDeferred<ADirectionalLight>(ADirectionalLight::StaticClass(), FTransform(FRotator(-24, 235, 0), FVector(0, 0, 100000)));
	Sun->GetRootComponent()->SetMobility(EComponentMobility::Movable);
	if (UDirectionalLightComponent* L = Cast<UDirectionalLightComponent>(Sun->GetLightComponent()))
	{
		// physical units (ExtendDefaultLuminanceRange): a clear-sky sun is ~100,000 lux;
		// 8 read as dusk, so auto-exposure lifted everything into fog-white
		L->SetIntensity(75000.f);
		L->SetLightSourceAngle(0.5357f);
		L->SetUseTemperature(true);
		L->SetTemperature(5200.f);
		L->bCastCloudShadows = true;
		L->SetAtmosphereSunLight(true);
		L->SetDynamicShadowDistanceMovableLight(400000.f);
	}
	Sun->FinishSpawning(FTransform(FRotator(-24, 235, 0), FVector(0, 0, 100000)));
	AActor* Atmos = W->SpawnActor<AActor>();
	USkyAtmosphereComponent* SA = NewObject<USkyAtmosphereComponent>(Atmos, TEXT("SkyAtmosphere"));
	Atmos->SetRootComponent(SA);
	SA->RegisterComponent();
	ASkyLight* Sky = W->SpawnActorDeferred<ASkyLight>(ASkyLight::StaticClass(), FTransform::Identity);
	USkyLightComponent* SL = Sky->GetLightComponent();
	SL->Mobility = EComponentMobility::Movable;
	// The shade side of a street is lit by the sky. Real-time capture of the atmosphere
	// contributed nothing in -game (measured: shade went fully black with Lumen off), so
	// light from the engine's daylight cubemap, scaled to a bright sky's luminance
	// (-SkyNits=N to tune).
	double Nits = 8000;
	FParse::Value(FCommandLine::Get(), TEXT("SkyNits="), Nits);
	SL->SourceType = ESkyLightSourceType::SLS_SpecifiedCubemap;
	SL->Cubemap = LoadObject<UTextureCube>(nullptr, TEXT("/Engine/MapTemplates/Sky/DaylightAmbientCubemap.DaylightAmbientCubemap"));
	SL->Intensity = (float)Nits;
	Sky->FinishSpawning(FTransform::Identity);
	// clouds: the engine's volumetric layer, which also gives the sky light something to scatter
	AActor* Clouds = W->SpawnActor<AActor>();
	UVolumetricCloudComponent* VC = NewObject<UVolumetricCloudComponent>(Clouds, TEXT("Clouds"));
	Clouds->SetRootComponent(VC);
	if (UMaterialInterface* CM = LoadObject<UMaterialInterface>(nullptr, TEXT("/Engine/EngineSky/VolumetricClouds/m_SimpleVolumetricCloud_Inst.m_SimpleVolumetricCloud_Inst"))) VC->SetMaterial(CM);
	VC->SetLayerBottomAltitude(2.5f);
	VC->SetLayerHeight(6.0f);
	VC->RegisterComponent();
	// A CAMERA IN SUNLIGHT. Auto-exposure free to roam metered the city like a
	// dim room and blew the pavement out; a sunny-day exposure sits near EV100 14-15
	// ("sunny 16"), so clamp it there and keep bloom to a hint.
	if (APostProcessVolume* PP = W->SpawnActor<APostProcessVolume>())
	{
		PP->bUnbound = true;
		FPostProcessSettings& S = PP->Settings;
		S.bOverride_AutoExposureMinBrightness = S.bOverride_AutoExposureMaxBrightness = true;
		S.AutoExposureMinBrightness = 13.0f;
		S.AutoExposureMaxBrightness = 14.5f;
		S.bOverride_BloomIntensity = true;
		S.BloomIntensity = 0.2f;
	}
	// light haze, not a fog bank: a city-scale density (the default 0.02 is a pea-souper over 2 km)
	if (AExponentialHeightFog* Fog = W->SpawnActor<AExponentialHeightFog>())
	{
		Fog->GetComponent()->SetFogDensity(0.0015f);
		Fog->GetComponent()->SetFogHeightFalloff(0.08f);
	}
}

void ABWGameMode::BeginPlay()
{
	Super::BeginPlay();
	SpawnSky();

	// play mode builds the town the player cuts, when the page sends it
	if (FParse::Param(FCommandLine::Get(), TEXT("Play"))) { StartPlayHost(); return; }
	FString Path;
	if (!FParse::Value(FCommandLine::Get(), TEXT("City="), Path)) Path = FPaths::ProjectDir() / TEXT("Data/city-1-metro.json");
	City = GetWorld()->SpawnActor<ACityBuilder>();
	if (!City->BuildFromFile(Path))
	{
		UE_LOG(LogBW, Error, TEXT("no city at %s — run: node unreal/tools/export-city.mjs"), *Path);
		return;
	}

	ABWPlayerController* PC = Cast<ABWPlayerController>(GetWorld()->GetFirstPlayerController());
	if (PC) PC->City = City;
	if (ABWCameraPawn* Cam = PC ? Cast<ABWCameraPawn>(PC->GetPawn()) : nullptr)
	{
		const FBox2D B = City->GetCity().Bounds;
		Cam->SetView(FVector(B.GetCenter(), 0), 0, -50, B.GetSize().GetMax() * 1.05);
	}

	FString Dir, SimUrl;
	FParse::Value(FCommandLine::Get(), TEXT("Shots="), ShotDir);
	FParse::Value(FCommandLine::Get(), TEXT("Years="), SimYears);
	// -Quality=low|medium|high: apply the graphics level without the page (for -Perf runs)
	FString Q;
	if (FParse::Value(FCommandLine::Get(), TEXT("Quality="), Q))
		if (ABWPlayerController* QPC = Cast<ABWPlayerController>(GetWorld()->GetFirstPlayerController())) QPC->PageInput(TEXT("quality"), 0, 0, 0, 0, 0, Q);
	// -Perf=N: N seconds of drone flight over the city, then log the frame-time spread and quit
	int32 PerfSecs = 0;
	if (FParse::Value(FCommandLine::Get(), TEXT("Perf="), PerfSecs) && PerfSecs > 0)
	{
		if (ABWCameraPawn* Cam = Cast<ABWCameraPawn>(GetWorld()->GetFirstPlayerController()->GetPawn())) Cam->SetMode(ABWCameraPawn::EMode::Drone);
		TSharedRef<TArray<float>> Frames = MakeShared<TArray<float>>();
		TSharedRef<double> Start = MakeShared<double>(0);
		FTimerHandle H;
		GetWorldTimerManager().SetTimer(H, [Frames, Start, PerfSecs]()
		{
			if (*Start == 0) *Start = FPlatformTime::Seconds();
			// a fast timer can fire several times in one frame to catch up: sample each frame once
			static uint64 LastFrame = 0;
			if (GFrameCounter == LastFrame) return;
			LastFrame = GFrameCounter;
			Frames->Add(FApp::GetDeltaTime() * 1000.f);
			if (FPlatformTime::Seconds() - *Start < PerfSecs) return;
			Frames->Sort();
			const int32 N = Frames->Num();
			const float Med = (*Frames)[N / 2], P95 = (*Frames)[FMath::Min(N - 1, N * 95 / 100)];
			UE_LOG(LogBW, Display, TEXT("PERF %d frames: median %.1f ms (%.0f fps), p95 %.1f ms (%.0f fps)"), N, Med, 1000.f / Med, P95, 1000.f / P95);
			FPlatformMisc::RequestExit(false);
		}, 0.001f, true, 20.0f); // every frame (a rate of 0 clears a timer); 20 s to settle streaming first
	}
	if (FParse::Param(FCommandLine::Get(), TEXT("Play"))) StartPlayHost();
	else if (FParse::Value(FCommandLine::Get(), TEXT("Sim="), SimUrl)) StartSim(SimUrl);
	else if (!ShotDir.IsEmpty()) RunShots(ShotDir);
}

// ---------------------------------------------------------------- live economy (sidecar)

void ABWGameMode::StartSim(const FString& Url)
{
	FModuleManager::LoadModuleChecked<FWebSocketsModule>(TEXT("WebSockets"));
	Sim = FWebSocketsModule::Get().CreateWebSocket(Url);
	TWeakObjectPtr<ABWGameMode> Self(this);
	const FBWCity& C = City->GetCity();
	const FString Town = FString::Printf(TEXT("{\"type\":\"town\",\"id\":1,\"seed\":%lld,\"size\":\"%s\",\"view\":true}"), C.Seed, *C.Size);
	Sim->OnConnected().AddLambda([Self, Town]() { if (Self.IsValid()) { UE_LOG(LogBW, Display, TEXT("SIM connected")); Self->SimStarted = FPlatformTime::Seconds(); Self->Sim->Send(Town); } });
	Sim->OnConnectionError().AddLambda([](const FString& E) { UE_LOG(LogBW, Error, TEXT("SIM connection error: %s"), *E); });
	Sim->OnMessage().AddLambda([Self](const FString& M) { if (Self.IsValid()) Self->OnSimMessage(M); });
	if (ABWCameraPawn* Cam = Cast<ABWCameraPawn>(GetWorld()->GetFirstPlayerController()->GetPawn()))
	{
		const FBox2D B = C.Bounds;
		Cam->SetView(FVector(B.GetCenter(), 0), 35, -30, B.GetSize().GetMax() * 0.7);
	}
	Sim->Connect();
}

void ABWGameMode::OnSimMessage(const FString& Msg)
{
	TSharedPtr<FJsonObject> R;
	if (!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Msg), R) || !R.IsValid()) return;
	const FString Type = R->GetStringField(TEXT("type"));
	if (Type == TEXT("error")) { UE_LOG(LogBW, Error, TEXT("SIM %s"), *R->GetStringField(TEXT("err"))); return; }
	const TSharedPtr<FJsonObject>* ViewObj;
	if (R->TryGetObjectField(TEXT("view"), ViewObj))
	{
		FString ViewJson;
		FJsonSerializer::Serialize(ViewObj->ToSharedRef(), TJsonWriterFactory<>::Create(&ViewJson));
		FBWRenderView View;
		if (View.Parse(ViewJson))
		{
			City->ApplyView(View);
			SimMonth = View.Month; SimYear = View.Year; SimPhase = View.Phase;
			SimFrames = 0;
			for (const FBWRenderLot& L : View.Lots) SimFrames += L.bConstruction ? 1 : 0;
			for (const FBWRenderEvent& E : View.Events)
				if (E.Kind == TEXT("build-start") || E.Kind == TEXT("delivered") || E.Kind == TEXT("demolished"))
					if (const FBWParcel* P = City->GetCity().FindParcel(E.Bbl))
						UE_LOG(LogBW, Display, TEXT("SIM %d  %-11s %s"), View.Year, *E.Kind, *P->Address);
		}
	}
	const int32 Month = SimMonth;
	auto Next = [this]() { Sim->Send(TEXT("{\"type\":\"month\",\"view\":true}")); };
	const bool bShotYear = Month >= 0 && Month % 12 == 0 && (Month / 12 == 0 || Month / 12 == 5 || Month / 12 == 10 || Month / 12 == 20 || Month / 12 == SimYears);
	if (Month >= SimYears * 12)
	{
		UE_LOG(LogBW, Display, TEXT("SIM done: %d years in %.0f s"), SimYears, FPlatformTime::Seconds() - SimStarted);
	}
	if (!ShotDir.IsEmpty() && bShotYear)
	{
		// let a frame render, then capture, then carry on (or stop)
		const FString Path = ShotDir / FString::Printf(TEXT("sim-year-%02d.png"), Month / 12);
		const bool bLast = Month >= SimYears * 12;
		// then a close-up of the tallest site going up, and back to the overview
		const TArray<FVector>& Sites = City->GetSites();
		const FVector* Tall = nullptr;
		for (const FVector& S : Sites) if (!Tall || S.Z > Tall->Z) Tall = &S;
		const FVector Site = Tall ? *Tall : FVector::ZeroVector;
		const FString Close = ShotDir / FString::Printf(TEXT("sim-year-%02d-site.png"), Month / 12);
		FTimerHandle H;
		GetWorldTimerManager().SetTimer(H, [this, Path, Close, Site, bLast, Next]()
		{
			SaveWindowShot(Path);
			ABWCameraPawn* Cam = Cast<ABWCameraPawn>(GetWorld()->GetFirstPlayerController()->GetPawn());
			if (!Cam || Site.IsZero()) { if (bLast) FPlatformMisc::RequestExit(false); else Next(); return; }
			const FVector Focus = Cam->Focus; const double Yaw = Cam->Yaw, Pitch = Cam->Pitch, Dist = Cam->Distance;
			Cam->SetView(FVector(Site.X, Site.Y, Site.Z * 0.5), 215, -24, FMath::Max(18000.0, Site.Z * 4.0));
			FTimerHandle H2;
			GetWorldTimerManager().SetTimer(H2, [this, Close, Focus, Yaw, Pitch, Dist, bLast, Next]()
			{
				SaveWindowShot(Close);
				if (ABWCameraPawn* C2 = Cast<ABWCameraPawn>(GetWorld()->GetFirstPlayerController()->GetPawn())) C2->SetView(Focus, Yaw, Pitch, Dist);
				if (bLast) FPlatformMisc::RequestExit(false); else Next();
			}, 2.5f, false);
		}, 2.5f, false);
		return;
	}
	if (Month < SimYears * 12) Next();
}

void ABWGameMode::SaveWindowShot(const FString& Path)
{
	TSharedPtr<SWindow> Window = GEngine && GEngine->GameViewport ? GEngine->GameViewport->GetWindow() : nullptr;
	TArray<FColor> Px;
	FIntVector Size;
	if (!Window.IsValid() || !FSlateApplication::Get().TakeScreenshot(Window.ToSharedRef(), Px, Size)) return;
	for (FColor& C : Px) C.A = 255;
	const bool bOk = FImageUtils::SaveImageByExtension(*Path, FImageView(Px.GetData(), Size.X, Size.Y));
	UE_LOG(LogBW, Display, TEXT("SHOT %s %s"), bOk ? TEXT("saved") : TEXT("FAILED"), *Path);
}

void ABWGameMode::RunShots(const FString& Dir)
{
	ABWPlayerController* PC = Cast<ABWPlayerController>(GetWorld()->GetFirstPlayerController());
	ABWCameraPawn* Cam = PC ? Cast<ABWCameraPawn>(PC->GetPawn()) : nullptr;
	if (!Cam) return;
	const FBox2D B = City->GetCity().Bounds;
	const FVector Mid(B.GetCenter(), 0);
	const double Span = B.GetSize().GetMax();

	// the tallest building is downtown; frame it for the close-ups
	FVector Tall = Mid;
	double TallZ = 0;
	for (const FBWVolume& V : City->GetCity().Volumes)
		if (V.Z1 > TallZ && V.Ring.Num()) { TallZ = V.Z1; FVector2D C(0, 0); for (const FVector2D& P : V.Ring) C += P; Tall = FVector(C / V.Ring.Num(), 0); }

	struct FShot { FString Name; FVector Focus; double Yaw, Pitch, Dist; bool bPick; int32 Mode = 0; };
	TArray<FShot> Shots = {
		{ TEXT("01-overview"), Mid, 0, -60, Span * 1.0, false },
		{ TEXT("02-oblique"), Mid, 35, -28, Span * 0.75, false },
		{ TEXT("03-downtown"), Tall, 210, -22, 90000, false },
		{ TEXT("04-low"), Tall + FVector(-20000, 4000, 0), 25, -16, 45000, false },
		{ TEXT("05-picked"), Tall, 300, -35, 60000, true },
		{ TEXT("06-street"), Tall + FVector(-3500, 2500, 1200), 40, -6, 4500, false },
		{ TEXT("07-facade"), Tall + FVector(-1500, 0, 2500), 20, -2, 2600, false },
		{ TEXT("08-drone"), Mid, 20, -20, Span * 0.45, false, 2 },
		{ TEXT("09-walk"), Tall + FVector(-5000, 1500, 0), 15, 6, 0, false, 3 },
		{ TEXT("10-people"), Tall, 0, -50, 1400, false, 4 },
	};
	// -Tour=N[,seed]: N views at random places and angles across the whole city, instead of the fixed set
	FString Tour;
	if (FParse::Value(FCommandLine::Get(), TEXT("Tour="), Tour))
	{
		FString NStr, SeedStr;
		if (!Tour.Split(TEXT(","), &NStr, &SeedStr)) { NStr = Tour; SeedStr = TEXT("7"); }
		FRandomStream R(FCString::Atoi(*SeedStr));
		TArray<const FBWVolume*> Pool;
		for (const FBWVolume& V : City->GetVolumes()) if (!V.bVacant && V.Deco.IsEmpty() && V.Z1 > 1200 && V.Ring.Num()) Pool.Add(&V);
		Shots.Reset();
		for (int32 i = 0; i < FCString::Atoi(*NStr) && Pool.Num(); ++i)
		{
			const FBWVolume& V = *Pool[R.RandRange(0, Pool.Num() - 1)];
			FVector2D C(0, 0);
			for (const FVector2D& P : V.Ring) C += P;
			C /= V.Ring.Num();
			const int32 Kind = i % 3;   // street-level, mid-height, rooftop overview
			const double Pitch = Kind == 0 ? -6 : Kind == 1 ? -22 : -38, Dist = Kind == 0 ? 3500 : Kind == 1 ? 12000 : 30000;
			if (Kind == 0 && City->GetCity().Centerlines.Num())
			{
				// street level: stand on a real street, on the kerb side of the right lane, looking down it
				const FBWCenterline& Cl = City->GetCity().Centerlines[R.RandRange(0, City->GetCity().Centerlines.Num() - 1)];
				if (Cl.Line.Num() >= 2 && Cl.Width >= 800)
				{
					const FVector2D A0 = Cl.Line[0], B0 = Cl.Line.Last(), Dir = (B0 - A0).GetSafeNormal();
					const FVector2D P = A0 + (B0 - A0) * 0.2 + FVector2D(Dir.Y, -Dir.X) * (Cl.Width * 0.5 - 60);
					Shots.Add({ FString::Printf(TEXT("tour-%02d"), i + 1), FVector(P, 0), FMath::RadiansToDegrees(FMath::Atan2(Dir.Y, Dir.X)) + R.FRandRange(-12, 12), 3, 0, false, 3 });
					continue;
				}
			}
			Shots.Add({ FString::Printf(TEXT("tour-%02d"), i + 1), FVector(C, V.Z1 * 0.4), R.FRandRange(0, 360), Kind == 0 ? -22 : Pitch, Kind == 0 ? 12000 : Dist, false });
		}
	}
	FString Only;
	if (FParse::Value(FCommandLine::Get(), TEXT("ShotOnly="), Only)) Shots.RemoveAll([&Only](const FShot& S) { return !S.Name.Contains(Only); });
	IFileManager::Get().MakeDirectory(*Dir, true);
	TSharedRef<int32> Step = MakeShared<int32>(0);
	TSharedRef<FTimerHandle> Handle = MakeShared<FTimerHandle>();
	TWeakObjectPtr<ABWGameMode> Self(this);
	// each view gets 3 s to settle (Lumen, virtual shadow maps), then a capture
	GetWorldTimerManager().SetTimer(*Handle, [Self, PC, Cam, Shots, Dir, Step, Handle]()
	{
		if (!Self.IsValid()) return;
		// three beats a shot: move the camera; pick (the view has rendered by
		// now, so deprojection uses it); capture
		const int32 I = *Step / 3, Beat = *Step % 3;
		if (I >= Shots.Num()) { FPlatformMisc::RequestExit(false); return; }
		const FShot& S = Shots[I];
		if (Beat == 0)
		{
			Cam->SetMode(ABWCameraPawn::EMode::Strategy);
			Cam->SetView(S.Focus, S.Yaw, S.Pitch, S.Dist);
			if (S.Mode == 2) Cam->SetMode(ABWCameraPawn::EMode::Drone);
			if (S.Mode == 3) { Cam->Mode = ABWCameraPawn::EMode::Street; Cam->Focus = S.Focus; Cam->Yaw = S.Yaw; Cam->Pitch = S.Pitch; }
			if (S.Mode == 4)
				for (TActorIterator<ACityLife> It(Self->GetWorld()); It; ++It)
				{
					FVector P; FVector2D F;
					if (It->PersonNear(S.Focus, P, F)) Cam->SetView(P + FVector(0, 0, 100), FMath::RadiansToDegrees(FMath::Atan2(-F.Y, -F.X)) + 25, S.Pitch, S.Dist);
				}
			PC->Select(nullptr);
		}
		else if (Beat == 1 && S.bPick)
		{
			int32 W, H;
			PC->GetViewportSize(W, H);
			PC->Select(PC->PickAt(FVector2D(W * 0.5, H * 0.5)));
		}
		else if (Beat == 2)
		{
			// do not photograph a half-loaded city: wait (up to two minutes) for
			// texture/mesh streaming and shader compiles to drain
			static double WaitStart = 0;
			int32 Pending = IStreamingManager::Get().GetNumWantingResources();
#if WITH_EDITOR
			if (GShaderCompilingManager) Pending += GShaderCompilingManager->GetNumRemainingJobs();
			Pending += FAssetCompilingManager::Get().GetNumRemainingAssets();
#endif
			if (Pending > 0)
			{
				if (WaitStart == 0) WaitStart = FPlatformTime::Seconds();
				if (FPlatformTime::Seconds() - WaitStart < 120) return;
				UE_LOG(LogBW, Warning, TEXT("SHOT %s taken with %d resources still pending"), *S.Name, Pending);
			}
			WaitStart = 0;
			Self->SaveWindowShot(Dir / (S.Name + TEXT(".png")));
		}
		++*Step;
	}, 2.0f, true, 15.0f); // 15 s first: textures and Nanite pages stream in before the first capture
}

// ---------------------------------------------------------------- play mode

void ABWGameMode::StartPlayHost()
{
	// the committed playable is the game; Unreal serves it so it has a real origin (saves)
	// in the repo: the committed playable (always the current build); packaged: Data/web
	FString Web = FPaths::ConvertRelativePathToFull(FPaths::ProjectDir() / TEXT("../../broadway-and-wall/playable"));
	if (!FPaths::FileExists(Web / TEXT("broadway-and-wall.html"))) Web = FPaths::ConvertRelativePathToFull(FPaths::ProjectDir() / TEXT("Data/web"));
	FParse::Value(FCommandLine::Get(), TEXT("Web="), Web);
	uint32 Port = 8770;
	FParse::Value(FCommandLine::Get(), TEXT("WebPort="), Port);
	FBWWebServer::Start(Web, Port);

	Bridge = NewObject<UBWBridge>(this);
	Bridge->Game = this;
	TWeakObjectPtr<ABWGameMode> Self(this);
	if (ABWPlayerController* PC = Cast<ABWPlayerController>(GetWorld()->GetFirstPlayerController()))
	{
		PC->OnPicked = [Self](const FBWParcel* P)
		{
			if (!Self.IsValid() || !Self->Browser.IsValid()) return;
			Self->Browser->ExecuteJavascript(FString::Printf(TEXT("window.bwUnreal && window.bwUnreal.select('%s')"), P ? *P->Bbl : TEXT("")));
		};
	}
	SAssignNew(Browser, SWebBrowser)
		.InitialURL(FString::Printf(TEXT("http://127.0.0.1:%u/game/broadway-and-wall.html?host=unreal"), Port))
		.ShowControls(false)
		.ShowAddressBar(false)
		.SupportsTransparency(true)
		.BackgroundColor(FColor(0, 0, 0, 0))
		.BrowserFrameRate(60)
		.OnLoadCompleted_Lambda([Self]()
		{
			if (!Self.IsValid() || !Self->Browser.IsValid() || Self->Browser->GetUrl().StartsWith(TEXT("about:"))) return;
			// a cross-site navigation lands in a renderer that never got the binding (Phase 0)
			Self->Browser->UnbindUObject(TEXT("bridge"), Self->Bridge, true);
			Self->Browser->BindUObject(TEXT("bridge"), Self->Bridge, true);
			// -PlayScript=<file.js>: a scripted player, for testing the whole loop unattended
			FString ScriptPath, Script;
			if (FParse::Value(FCommandLine::Get(), TEXT("PlayScript="), ScriptPath) && FFileHelper::LoadFileToString(Script, *ScriptPath))
				Self->Browser->ExecuteJavascript(Script);
		})
		.OnConsoleMessage_Lambda([](const FString& Msg, const FString&, int32, EWebBrowserConsoleLogSeverity)
		{
			UE_LOG(LogBW, Display, TEXT("PAGE: %s"), *Msg.Left(300));
		});
	Browser->BindUObject(TEXT("bridge"), Bridge, true);
	GEngine->GameViewport->AddViewportWidgetContent(Browser.ToSharedRef(), 100);
	FSlateApplication::Get().SetKeyboardFocus(Browser);
	if (APlayerController* PC = GetWorld()->GetFirstPlayerController()) { PC->bShowMouseCursor = true; PC->SetInputMode(FInputModeUIOnly()); }
	UE_LOG(LogBW, Display, TEXT("PLAY serving the game from %s"), *Web);
	// -PlayShots=<dir>: a screenshot every 20 s (desks and city together), six of them, then quit
	FString PlayShots;
	if (FParse::Value(FCommandLine::Get(), TEXT("PlayShots="), PlayShots))
	{
		IFileManager::Get().MakeDirectory(*PlayShots, true);
		TSharedRef<int32> N = MakeShared<int32>(0);
		FTimerHandle H;
		GetWorldTimerManager().SetTimer(H, [Self, PlayShots, N]()
		{
			if (!Self.IsValid()) return;
			Self->SaveWindowShot(PlayShots / FString::Printf(TEXT("play-%02d.png"), ++*N));
			if (*N >= 6) FPlatformMisc::RequestExit(false);
		}, 20.f, true, 20.f);
	}
}

void ABWGameMode::OnPageCity(const FString& Json)
{
	// a new town: throw the old one away and build the one the player cut
	if (City) City->Destroy();
	City = GetWorld()->SpawnActor<ACityBuilder>();
	if (!City->BuildFromText(Json)) { UE_LOG(LogBW, Error, TEXT("PLAY the page sent a city that would not build")); return; }
	ABWPlayerController* PC = Cast<ABWPlayerController>(GetWorld()->GetFirstPlayerController());
	if (PC) PC->City = City;
	if (ABWCameraPawn* Cam = PC ? Cast<ABWCameraPawn>(PC->GetPawn()) : nullptr)
	{
		const FBox2D B = City->GetCity().Bounds;
		Cam->SetView(FVector(B.GetCenter(), 0), 30, -38, B.GetSize().GetMax() * 0.8);
	}
	UE_LOG(LogBW, Display, TEXT("PLAY city %s: %d lots"), *City->GetCity().Name, City->GetCity().Parcels.Num());
}

void ABWGameMode::OnPageView(const FString& Json)
{
	FBWRenderView View;
	if (!City || !View.Parse(Json)) return;
	City->ApplyView(View);
	SimMonth = View.Month; SimYear = View.Year; SimPhase = View.Phase;
	SimFrames = 0;
	for (const FBWRenderLot& L : View.Lots) SimFrames += L.bConstruction ? 1 : 0;
	SetSeason(View.Month);
}

void ABWGameMode::OnPageSelect(const FString& Bbl)
{
	ABWPlayerController* PC = Cast<ABWPlayerController>(GetWorld()->GetFirstPlayerController());
	if (PC && City) PC->ShowSelected(Bbl.IsEmpty() ? nullptr : City->GetCity().FindParcel(Bbl));
}

void ABWGameMode::OnPageInput(const FString& Json)
{
	TSharedPtr<FJsonObject> O;
	if (!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Json), O) || !O.IsValid()) return;
	ABWPlayerController* PC = Cast<ABWPlayerController>(GetWorld()->GetFirstPlayerController());
	if (!PC) return;
	double X = 0, Y = 0, Dx = 0, Dy = 0, W = 0;
	FString K;
	O->TryGetNumberField(TEXT("x"), X); O->TryGetNumberField(TEXT("y"), Y);
	O->TryGetNumberField(TEXT("dx"), Dx); O->TryGetNumberField(TEXT("dy"), Dy);
	O->TryGetNumberField(TEXT("w"), W); O->TryGetStringField(TEXT("k"), K);
	PC->PageInput(O->GetStringField(TEXT("t")), X, Y, Dx, Dy, W, K);
}

void ABWGameMode::SetSeason(int32 Month)
{
	// Late afternoon throughout (the reference light), at the latitude of the
	// generator's city (~41 N): the sun at 4 pm stands ~12 deg up in late
	// December and ~45 deg in late June. Game month 0 is January.
	if (!Sun) return;
	const double Phase = FMath::Cos(2.0 * PI * ((Month % 12) - 5.7) / 12.0);   // +1 late June, -1 late December
	const double Elev = 28.5 + 16.5 * Phase;
	Sun->SetActorRotation(FRotator(-Elev, 235 + 10 * Phase, 0));
	if (UDirectionalLightComponent* L = Cast<UDirectionalLightComponent>(Sun->GetLightComponent()))
		L->SetTemperature(4600.f + 1100.f * float(Phase + 1.0) * 0.5f);   // redder winter afternoons
}
