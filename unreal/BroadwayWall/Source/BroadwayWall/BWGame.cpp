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
#include "Materials/MaterialInstanceDynamic.h"
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
	Camera = CreateDefaultSubobject<UBWCameraComponent>(TEXT("Camera"));
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
	// THE BUILD DESK'S MODEL. While the desk shows its model box, the camera
	// looks at the scheme on its lot, framed into the box: the view centre is
	// shifted onto the box's middle and the distance set so the building fills
	// about three quarters of the box's height. It stays where the player
	// drags it (owner, Oct 2026: "instead of it rotating around the building
	// automatically, make it so you can click and drag"); it used to spin slowly
	// whenever the player let go.
	if (DeskRect.Z > 0)
	{
		FVector Base; double Hb = 0, Span = 0;
		const ABWGameMode* GM = GetWorld()->GetAuthGameMode<ABWGameMode>();
		if (GM && GM->City && GM->City->PreviewBounds(Base, Hb, Span))
		{
			DeskHeld = FMath::Max(0.0, DeskHeld - Dt);
			const double Pt = DeskPitch != 0 ? DeskPitch : DeskZoom < 0.3 ? -6 : -20;   // the tightest close-up stands at the kerb
			const double Aspect = Camera->AspectRatio > 0 ? Camera->AspectRatio : 16.0 / 9.0;
			const double TanV = FMath::Tan(FMath::DegreesToRadians(Camera->FieldOfView * 0.5)) / Aspect;
			const double Extent = FMath::Max(Hb, Span * 0.75) + 1500;
			const double Dist = DeskZoom * Extent / (1.5 * FMath::Max(0.1, DeskRect.W) * TanV);
			const FRotator Rot(Pt, DeskYaw, 0);
			const FVector Look(Base.X, Base.Y, DeskZoom < 0.3 ? 300.0 : Hb * (DeskZoom < 1 ? 0.2 : 0.45));
			SetActorLocationAndRotation(Look - Rot.Vector() * Dist, Rot);
			Camera->Offset = FVector2D(1.0 - 2.0 * (DeskRect.X + DeskRect.Z * 0.5), 2.0 * (DeskRect.Y + DeskRect.W * 0.5) - 1.0);
			return;
		}
	}
	Camera->Offset = FVector2D::ZeroVector;
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

void ABWCameraPawn::SetDeskRect(const FVector4& R)
{
	const bool bWas = DeskRect.Z > 0, bNow = R.Z > 0;
	if (bNow && !bWas) { SavedFocus = Focus; SavedYaw = Yaw; SavedPitch = Pitch; SavedDistance = Distance; DeskYaw = Yaw + 30; }
	if (!bNow && bWas) { Focus = SavedFocus; Yaw = SavedYaw; Pitch = SavedPitch; Distance = SavedDistance; }
	DeskRect = R;
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
	// the selection band keeps its width on screen as the camera zooms (cheap when nothing changed)
	if (City.IsValid() && (Selected || Hovered))
	{
		// sized by how far the camera is from the lot itself (the Build desk camera orbits the lot, not the map focus)
		const FBWParcel* P = Selected ? Selected : Hovered;
		FVector2D C(0, 0); for (const FVector2D& Q : P->Ring) C += Q; C /= FMath::Max(1, P->Ring.Num());
		City->SetHighlight(Selected, Hovered, FVector::Dist(Cam->GetActorLocation(), FVector(C, 0)));
	}

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
		if (HoverClock > 0.1 && HoverPx.X >= 0) { HoverClock = 0; Hovered = PickAt(HoverPx); if (City.IsValid()) City->SetHighlight(Selected, Hovered, (Cast<ABWCameraPawn>(GetPawn()) ? FVector::Dist(Cast<ABWCameraPawn>(GetPawn())->GetActorLocation(), Cast<ABWCameraPawn>(GetPawn())->Focus) : 0)); }
	}
	if (WasInputKeyJustPressed(EKeys::LeftMouseButton))
	{
		float X, Y;
		if (GetMousePosition(X, Y)) { Select(PickAt(FVector2D(X, Y))); if (OnPicked) OnPicked(Selected); }
	}
}

/**
 * THE PRESETS, as option strings (the Settings page offers the same four and
 * lets every option be changed after). Measured on the metro city at 1080p,
 * RTX 2080 (see UE58_PLAN.md for the table): the render resolution and the
 * lighting method are the two big levers; the rest are a few ms each.
 */
FString BWGraphicsPreset(const FString& Name)
{
	// (Low keeps Lumen at its lowest: the screen-space fallback measured slower here)
	if (Name == TEXT("low"))    return TEXT("res=50;up=auto;gi=lumen;giq=2;refl=ssr;shadow=1;view=1;tex=2;fx=1;post=1;clouds=1;life=1;fps=0;vsync=0;blur=0");
	if (Name == TEXT("medium")) return TEXT("res=67;up=auto;gi=lumen;giq=2;refl=lumen;shadow=2;view=2;tex=3;fx=2;post=2;clouds=1;life=2;fps=0;vsync=0;blur=0");
	if (Name == TEXT("ultra"))  return TEXT("res=100;up=auto;gi=lumen;giq=4;refl=lumen;shadow=4;view=4;tex=3;fx=3;post=3;clouds=2;life=2;fps=0;vsync=0;blur=0");
	return TEXT("res=100;up=auto;gi=lumen;giq=3;refl=lumen;shadow=3;view=3;tex=3;fx=3;post=3;clouds=2;life=2;fps=0;vsync=0;blur=0");   // high
}

/** Apply a graphics option string ("key=value;..."); unknown keys are ignored, missing ones left as they are. */
void BWApplyGraphics(UWorld* World, const FString& Opts)
{
	TMap<FString, FString> O;
	TArray<FString> Parts;
	Opts.ParseIntoArray(Parts, TEXT(";"));
	for (const FString& P : Parts) { FString K, V; if (P.Split(TEXT("="), &K, &V)) O.Add(K.TrimStartAndEnd(), V.TrimStartAndEnd()); }
	auto Int = [&O](const TCHAR* K, int32 Def) { const FString* V = O.Find(K); return V ? FCString::Atoi(**V) : Def; };
	auto CVar = [](const TCHAR* N, float V) { if (IConsoleVariable* C = IConsoleManager::Get().FindConsoleVariable(N)) C->Set(V, ECVF_SetByGameSetting); };

	// the scalability groups (0 low .. 3 epic, 4 cinematic)
	Scalability::FQualityLevels Q = Scalability::GetQualityLevels();
	if (O.Contains(TEXT("shadow"))) Q.ShadowQuality = Int(TEXT("shadow"), 3);
	if (O.Contains(TEXT("view"))) { Q.ViewDistanceQuality = Int(TEXT("view"), 3); Q.FoliageQuality = FMath::Min(3, Int(TEXT("view"), 3)); }
	if (O.Contains(TEXT("tex"))) Q.TextureQuality = Int(TEXT("tex"), 3);
	if (O.Contains(TEXT("fx"))) { Q.EffectsQuality = Int(TEXT("fx"), 3); Q.ShadingQuality = FMath::Max(1, Int(TEXT("fx"), 3)); }
	if (O.Contains(TEXT("post"))) Q.PostProcessQuality = Int(TEXT("post"), 3);
	if (O.Contains(TEXT("giq"))) { Q.GlobalIlluminationQuality = Int(TEXT("giq"), 3); Q.ReflectionQuality = Int(TEXT("giq"), 3); }
	Scalability::SetQualityLevels(Q);

	// lighting: Lumen (dynamic, bounced), screen-space, or none
	if (const FString* Gi = O.Find(TEXT("gi")))
		CVar(TEXT("r.DynamicGlobalIlluminationMethod"), *Gi == TEXT("lumen") ? 1.f : *Gi == TEXT("ssgi") ? 2.f : 0.f);
	if (const FString* Rf = O.Find(TEXT("refl")))
		CVar(TEXT("r.ReflectionMethod"), *Rf == TEXT("lumen") ? 1.f : *Rf == TEXT("ssr") ? 2.f : 0.f);

	// resolution and the upscaler: DLSS where the plugin and an RTX card are
	// there (auto/dlss), otherwise TSR
	const FString Up = O.FindRef(TEXT("up"));
	IConsoleVariable* Dlss = IConsoleManager::Get().FindConsoleVariable(TEXT("r.NGX.DLSS.Enable"));
	if (Dlss && !Up.IsEmpty()) Dlss->Set(Up != TEXT("tsr") && !FParse::Param(FCommandLine::Get(), TEXT("NoDLSS")) ? 1 : 0, ECVF_SetByGameSetting);
	if (O.Contains(TEXT("res"))) CVar(TEXT("r.ScreenPercentage"), float(FMath::Clamp(Int(TEXT("res"), 100), 33, 100)));

	// clouds: their shadows on the city and their light in the sky cost ~3 ms
	// at 1080p on an RTX 2080 (profilegpu: VolumetricCloudShadow), which is a
	// fifth of the Low preset's whole frame; 1 keeps the clouds, drops that
	if (O.Contains(TEXT("clouds")))
	{
		const int32 Cl = Int(TEXT("clouds"), 2);
		CVar(TEXT("r.VolumetricCloud.ShadowMap"), Cl >= 2 ? 1.f : 0.f);
		CVar(TEXT("r.VolumetricCloud.SkyAO"), Cl >= 2 ? 1.f : 0.f);
		CVar(TEXT("r.VolumetricCloud.ViewRaySampleMaxCount"), Cl >= 2 ? 768.f : 256.f);
	}
	if (O.Contains(TEXT("fps"))) CVar(TEXT("t.MaxFPS"), float(Int(TEXT("fps"), 0)));
	if (O.Contains(TEXT("vsync"))) CVar(TEXT("r.VSync"), float(Int(TEXT("vsync"), 0)));
	if (O.Contains(TEXT("blur"))) CVar(TEXT("r.MotionBlurQuality"), Int(TEXT("blur"), 0) ? 3.f : 0.f);

	// the street's life
	if (O.Contains(TEXT("life")))
	{
		ACityLife::DensityLevel = Int(TEXT("life"), 2);
		if (World) for (TActorIterator<ACityLife> It(World); It; ++It) It->SetDensity(ACityLife::DensityLevel);
	}

	UE_LOG(LogBW, Display, TEXT("GRAPHICS %s (%s)"), *Opts, Dlss && Dlss->GetInt() ? TEXT("DLSS") : TEXT("TSR"));
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
	else if (Type == TEXT("quality") || Type == TEXT("gfx"))
	{
		// GRAPHICS, from the game's Settings page: a preset ("quality", key
		// low|medium|high|ultra) or the full set of choices ("gfx", key
		// "res=67;gi=lumen;..."); see ApplyGraphics.
		BWApplyGraphics(GetWorld(), Type == TEXT("quality") ? BWGraphicsPreset(Key) : Key);
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
	if (GetWorld()->LineTraceSingleByChannel(Hit, Origin, Origin + Dir * 2000000, ECC_Visibility, Q))
		if (const FBWParcel* P = City->ParcelFromHit(Hit)) return P;
	// THE GROUND HAS NO COLLISION (cooking the whole city floor would cost the
	// load), so a click on a lot's open ground or a vacant lot passed straight
	// through. Where the ray meets the ground plane (a lot's cover stands about
	// 20 cm up), take the lot there.
	if (Dir.Z < -1e-3)
	{
		const FVector G = Origin + Dir * ((20.0 - Origin.Z) / Dir.Z);
		return City->ParcelAt(FVector2D(G.X, G.Y));
	}
	return nullptr;
}

void ABWPlayerController::Select(const FBWParcel* P)
{
	Selected = P;
	if (!City.IsValid()) return;
	City->SetHighlight(Selected, Hovered, (Cast<ABWCameraPawn>(GetPawn()) ? FVector::Dist(Cast<ABWCameraPawn>(GetPawn())->GetActorLocation(), Cast<ABWCameraPawn>(GetPawn())->Focus) : 0));
	if (P) UE_LOG(LogBW, Display, TEXT("PICK %s  %s  (%s, %d fl, top %.0f m)"), *P->Bbl, *P->Address, *P->Cls, P->Floors, City->ParcelTop(P->Bbl) / 100.0);
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
	Atmosphere = SA;
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
	SkyLight = SL;
	// clouds: the engine's volumetric layer, which also gives the sky light something to scatter
	AActor* Clouds = W->SpawnActor<AActor>();
	UVolumetricCloudComponent* VC = NewObject<UVolumetricCloudComponent>(Clouds, TEXT("Clouds"));
	Clouds->SetRootComponent(VC);
	if (UMaterialInterface* CM = LoadObject<UMaterialInterface>(nullptr, TEXT("/Engine/EngineSky/VolumetricClouds/m_SimpleVolumetricCloud_Inst.m_SimpleVolumetricCloud_Inst")))
	{
		CloudMat = UMaterialInstanceDynamic::Create(CM, Clouds);
		VC->SetMaterial(CloudMat);
	}
	VC->SetLayerBottomAltitude(2.5f);
	VC->SetLayerHeight(6.0f);
	VC->RegisterComponent();
	// A CAMERA IN SUNLIGHT. Auto-exposure free to roam metered the city like a
	// dim room and blew the pavement out; a sunny-day exposure sits near EV100 14-15
	// ("sunny 16"), so clamp it there and keep bloom to a hint.
	if (APostProcessVolume* PP = W->SpawnActor<APostProcessVolume>())
	{
		Post = PP;
		PP->bUnbound = true;
		FPostProcessSettings& S = PP->Settings;
		S.bOverride_AutoExposureMinBrightness = S.bOverride_AutoExposureMaxBrightness = true;
		S.AutoExposureMinBrightness = 13.0f;
		S.AutoExposureMaxBrightness = 14.5f;
		S.bOverride_BloomIntensity = true;
		S.BloomIntensity = 0.2f;
	}
	// light haze, not a fog bank: a city-scale density (the default 0.02 is a pea-souper over 2 km)
	if ((Fog = W->SpawnActor<AExponentialHeightFog>()) != nullptr)
	{
		Fog->GetComponent()->SetFogDensity(0.0015f);
		Fog->GetComponent()->SetFogHeightFalloff(0.08f);
	}
	// the month the shots and the menu city open in (-Month=N, 0 = January)
	int32 M = 4;
	FParse::Value(FCommandLine::Get(), TEXT("Month="), M);
	SetSeason(M);
}

void ABWGameMode::BeginPlay()
{
	Super::BeginPlay();
	SpawnSky();

	// play mode builds the town the player cuts, when the page sends it. A packaged
	// build is the game, so it plays unless asked for a city tool (-Shots, -Tour,
	// -Perf, -Sim, -KitThumbs, -NoPlay); the editor's runs stay tools unless -Play.
	const TCHAR* Cmd = FCommandLine::Get();
	FString Unused;
	const bool bTool = FParse::Param(Cmd, TEXT("NoPlay")) || FParse::Value(Cmd, TEXT("Shots="), Unused) || FParse::Value(Cmd, TEXT("Tour="), Unused)
		|| FParse::Value(Cmd, TEXT("Perf="), Unused) || FParse::Value(Cmd, TEXT("Sim="), Unused) || FParse::Param(Cmd, TEXT("KitThumbs"));
	bPlayMode = FParse::Param(Cmd, TEXT("Play")) || (!GIsEditor && !bTool);
	if (bPlayMode) { StartPlayHost(); return; }
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
	FString Gfx;
	if (FParse::Value(FCommandLine::Get(), TEXT("Gfx="), Gfx, false)) BWApplyGraphics(GetWorld(), Gfx);
	FString Q;
	if (FParse::Value(FCommandLine::Get(), TEXT("Quality="), Q))
		if (ABWPlayerController* QPC = Cast<ABWPlayerController>(GetWorld()->GetFirstPlayerController())) QPC->PageInput(TEXT("quality"), 0, 0, 0, 0, 0, Q);
	// -Perf=N: N seconds of drone flight over the city, then log the frame-time spread and quit
	int32 PerfSecs = 0;
	if (FParse::Value(FCommandLine::Get(), TEXT("Perf="), PerfSecs) && PerfSecs > 0)
	{
		if (ABWCameraPawn* Cam = Cast<ABWCameraPawn>(GetWorld()->GetFirstPlayerController()->GetPawn())) Cam->SetMode(ABWCameraPawn::EMode::Drone);
		TSharedRef<TArray<float>> Frames = MakeShared<TArray<float>>();
		TSharedRef<TArray<FVector3f>> Threads = MakeShared<TArray<FVector3f>>();   // game, render, GPU ms
		TSharedRef<double> Start = MakeShared<double>(0);
		FTimerHandle H;
		GetWorldTimerManager().SetTimer(H, [Frames, Threads, Start, PerfSecs]()
		{
			if (*Start == 0) *Start = FPlatformTime::Seconds();
			// a fast timer can fire several times in one frame to catch up: sample each frame once
			static uint64 LastFrame = 0;
			if (GFrameCounter == LastFrame) return;
			LastFrame = GFrameCounter;
			Frames->Add(FApp::GetDeltaTime() * 1000.f);
			Threads->Add(FVector3f(FPlatformTime::ToMilliseconds(GGameThreadTime), FPlatformTime::ToMilliseconds(GRenderThreadTime), FPlatformTime::ToMilliseconds(RHIGetGPUFrameCycles())));
			// -ProfileGPU: one GPU profile, halfway through the flight, into the log
			static bool bProfiled = false;
			if (!bProfiled && FParse::Param(FCommandLine::Get(), TEXT("ProfileGPU")) && FPlatformTime::Seconds() - *Start > PerfSecs * 0.5)
			{
				bProfiled = true;
				if (GEngine) GEngine->Exec(nullptr, TEXT("profilegpu"));
			}
			if (FPlatformTime::Seconds() - *Start < PerfSecs) return;
			Frames->Sort();
			const int32 N = Frames->Num();
			const float Med = (*Frames)[N / 2], P95 = (*Frames)[FMath::Min(N - 1, N * 95 / 100)];
			UE_LOG(LogBW, Display, TEXT("PERF %d frames: median %.1f ms (%.0f fps), p95 %.1f ms (%.0f fps)"), N, Med, 1000.f / Med, P95, 1000.f / P95);
			// which thread is the floor: the median of each
			auto MedOf = [&Threads](int32 C) { TArray<float> V; for (const FVector3f& T : *Threads) V.Add(C == 0 ? T.X : C == 1 ? T.Y : T.Z); V.Sort(); return V.Num() ? V[V.Num() / 2] : 0.f; };
			UE_LOG(LogBW, Display, TEXT("PERF threads: game %.1f ms, render %.1f ms, GPU %.1f ms"), MedOf(0), MedOf(1), MedOf(2));
			FPlatformMisc::RequestExit(false);
		}, 0.001f, true, 20.0f); // every frame (a rate of 0 clears a timer); 20 s to settle streaming first
	}
	if (bPlayMode) StartPlayHost();
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

	// STREET LEVEL NEAR DOWNTOWN: a fixed offset from the tallest tower stood the
	// camera inside a building (a black frame). Stand instead on the sidewalk of
	// the nearest real street (8 m+ kerb to kerb), 2 m in from the kerb, a
	// third of the way along it, looking down it.
	FVector Street = Tall;
	double StreetYaw = 40;
	{
		double Best = 1e18;
		for (const FBWCenterline& Cl : City->GetCity().Centerlines)
		{
			if (Cl.Line.Num() < 2 || Cl.Width < 800) continue;
			const FVector2D A0 = Cl.Line[0], B0 = Cl.Line.Last();
			if ((B0 - A0).Size() < 6000) continue;
			const FVector2D Dir = (B0 - A0).GetSafeNormal();
			const FVector2D P = A0 + (B0 - A0) * 0.3 + FVector2D(Dir.Y, -Dir.X) * (Cl.Width * 0.5 + 200);
			const double D = (P - FVector2D(Tall)).SizeSquared();
			if (D < Best && !City->ParcelAt(P)) { Best = D; Street = FVector(P, 0); StreetYaw = FMath::RadiansToDegrees(FMath::Atan2(Dir.Y, Dir.X)) + 8; }
		}
	}
	struct FShot { FString Name; FVector Focus; double Yaw, Pitch, Dist; bool bPick; int32 Mode = 0; FString Kit; FString Bbl; };
	TArray<FShot> Shots = {
		{ TEXT("01-overview"), Mid, 0, -60, Span * 1.0, false },
		{ TEXT("02-oblique"), Mid, 35, -28, Span * 0.75, false },
		{ TEXT("03-downtown"), Tall, 210, -22, 90000, false },
		{ TEXT("04-low"), Tall + FVector(-20000, 4000, 0), 25, -16, 45000, false },
		{ TEXT("05-picked"), Tall, 300, -35, 60000, true },
		{ TEXT("06-street"), Street, StreetYaw, 2, 0, false, 3 },
		{ TEXT("07-facade"), Tall + FVector(-1500, 0, 2500), 20, -2, 2600, false },
		{ TEXT("08-drone"), Mid, 20, -20, Span * 0.45, false, 2 },
		{ TEXT("09-walk"), Tall + FVector(-5000, 1500, 0), 15, 6, 0, false, 3 },
		{ TEXT("10-people"), Tall, 0, -50, 1400, false, 4 },
	};
	// -Tour=N[,seed]: N views at random places and angles across the whole city, instead of the fixed set
	FString Tour;
	if (FParse::Value(FCommandLine::Get(), TEXT("Tour="), Tour, false))
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
				// street level: stand on the sidewalk of a real street, 2 m in from the kerb
				// (clear of the parking lane), looking down it
				const FBWCenterline& Cl = City->GetCity().Centerlines[R.RandRange(0, City->GetCity().Centerlines.Num() - 1)];
				if (Cl.Line.Num() >= 2 && Cl.Width >= 800)
				{
					const FVector2D A0 = Cl.Line[0], B0 = Cl.Line.Last(), Dir = (B0 - A0).GetSafeNormal();
					const FVector2D P = A0 + (B0 - A0) * 0.2 + FVector2D(Dir.Y, -Dir.X) * (Cl.Width * 0.5 + 200);
					Shots.Add({ FString::Printf(TEXT("tour-%02d"), i + 1), FVector(P, 0), FMath::RadiansToDegrees(FMath::Atan2(Dir.Y, Dir.X)) + R.FRandRange(-12, 12), 3, 0, false, 3 });
					continue;
				}
			}
			Shots.Add({ FString::Printf(TEXT("tour-%02d"), i + 1), FVector(C, V.Z1 * 0.4), R.FRandRange(0, 360), Kind == 0 ? -22 : Pitch, Kind == 0 ? 12000 : Dist, false });
		}
	}
	// -Look=X,Y,Yaw,Pitch,Dist: one view of a given spot (cm, degrees), named "look"
	FString Look;
	if (FParse::Value(FCommandLine::Get(), TEXT("Look="), Look, false))
	{
		TArray<FString> P; Look.ParseIntoArray(P, TEXT(","));
		if (P.Num() == 5)
		{
			Shots.Reset();
			Shots.Add({ TEXT("look"), FVector(FCString::Atod(*P[0]), FCString::Atod(*P[1]), 0), FCString::Atod(*P[2]), FCString::Atod(*P[3]), FCString::Atod(*P[4]), false });
		}
	}
	// -LookFile=path.json: a list of named views, [{"name","x","y","yaw","pitch","dist"}] (cm,
	// degrees), one picture each (unreal/tools/form-gallery.mjs writes one per building form)
	FString LookFile;
	if (FParse::Value(FCommandLine::Get(), TEXT("LookFile="), LookFile))
	{
		FString Json;
		TArray<TSharedPtr<FJsonValue>> Arr;
		if (FFileHelper::LoadFileToString(Json, *LookFile) && FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Json), Arr))
		{
			Shots.Reset();
			for (const TSharedPtr<FJsonValue>& V : Arr)
			{
				const TSharedPtr<FJsonObject> O = V->AsObject();
				if (!O) continue;
				double Z = 0; O->TryGetNumberField(TEXT("z"), Z);
				Shots.Add({ O->GetStringField(TEXT("name")), FVector(O->GetNumberField(TEXT("x")), O->GetNumberField(TEXT("y")), Z),
					O->GetNumberField(TEXT("yaw")), O->GetNumberField(TEXT("pitch")), O->GetNumberField(TEXT("dist")), false });
			}
		}
	}
	// -KitThumbs: one picture of each facade kit for the Build desk's picker: a
	// six-storey block in that kit on one mid-sized lot, framed by the desk camera
	// (run at a thumbnail resolution; unreal/tools/kit-thumbs.ps1 does the rest)
	if (FParse::Param(FCommandLine::Get(), TEXT("KitThumbs")))
	{
		const FBWParcel* Lot = nullptr;
		double Best = 1e18;
		for (const FBWParcel& P : City->GetCity().Parcels)
		{
			// a big, square-ish lot: a style judged on a sliver reads as a sliver
			if (P.Ring.Num() < 4 || P.LotArea < 20000 || P.LotArea > 60000) continue;
			double Narrow = 1e18;
			for (int32 i = 0; i < P.Ring.Num(); ++i)
			{
				const FVector2D E = (P.Ring[(i + 1) % P.Ring.Num()] - P.Ring[i]).GetSafeNormal();
				const FVector2D Nrm(-E.Y, E.X);
				double Lo = 1e18, Hi = -1e18;
				for (const FVector2D& Q : P.Ring) { const double T = FVector2D::DotProduct(Q, Nrm); Lo = FMath::Min(Lo, T); Hi = FMath::Max(Hi, T); }
				Narrow = FMath::Min(Narrow, Hi - Lo);
			}
			if (Narrow < 2800) continue;
			FVector2D C(0, 0); for (const FVector2D& Q : P.Ring) C += Q; C /= P.Ring.Num();
			const double D2 = C.SizeSquared();
			if (D2 < Best) { Best = D2; Lot = &P; }
		}
		Shots.Reset();
		if (Lot) for (const FString& K : City->KitNames()) Shots.Add({ TEXT("kit-") + K, FVector::ZeroVector, 0, 0, 0, false, 0, K, Lot->Bbl });
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
		if (Beat == 0 && !S.Kit.IsEmpty())
		{
			FBWLook Look;
			Look.Kit = S.Kit;
			Look.Top = TEXT("cornice");
			int32 TF = 6; FParse::Value(FCommandLine::Get(), TEXT("KitFloors="), TF);   // -KitFloors=N: thumbnails at another height
			Self->City->SetPreview(S.Bbl, TF, 0.7, FString(), TEXT("office"), 1990, Look);
			Cam->DeskSpin = 0;
			FParse::Value(FCommandLine::Get(), TEXT("KitZoom="), Cam->DeskZoom);
			Cam->SetDeskRect(FVector4(0.08, 0.04, 0.84, 0.92));
			// look the way the light travels, a little off it: the sunlit faces
			Cam->DeskYaw = Self->Sun ? Self->Sun->GetActorRotation().Yaw - 30.0 : 215;
			PC->Select(nullptr);
		}
		else if (Beat == 0)
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
	// -PlayShots=<dir>: a screenshot every 20 s (desks and city together), six of
	// them (-PlayShotCount=N), then quit
	FString PlayShots;
	int32 ShotCount = 6;
	FParse::Value(FCommandLine::Get(), TEXT("PlayShotCount="), ShotCount);
	if (FParse::Value(FCommandLine::Get(), TEXT("PlayShots="), PlayShots))
	{
		IFileManager::Get().MakeDirectory(*PlayShots, true);
		TSharedRef<int32> N = MakeShared<int32>(0);
		FTimerHandle H;
		GetWorldTimerManager().SetTimer(H, [Self, PlayShots, N, ShotCount]()
		{
			if (!Self.IsValid()) return;
			Self->SaveWindowShot(PlayShots / FString::Printf(TEXT("play-%02d.png"), ++*N));
			if (*N >= ShotCount) FPlatformMisc::RequestExit(false);
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
	const FString T = O->GetStringField(TEXT("t"));
	// the Build desk: the scheme being designed, and the box its model shows in
	if (T == TEXT("preview") && City)
	{
		FString Bbl, Facade, Cls; double Floors = 1, Cov = 0, Year = 0;
		O->TryGetStringField(TEXT("bbl"), Bbl); O->TryGetStringField(TEXT("facade"), Facade); O->TryGetStringField(TEXT("cls"), Cls);
		O->TryGetNumberField(TEXT("floors"), Floors); O->TryGetNumberField(TEXT("cov"), Cov); O->TryGetNumberField(TEXT("year"), Year);
		City->SetPreview(Bbl, int32(Floors), Cov, Facade, Cls, int32(Year), BWReadLook(O), BWReadTiers(O));
		return;
	}
	if (T == TEXT("preview-off") && City) { City->ClearPreview(); return; }
	// the lens: the page's number per deed, tinted on the lots (ui-revamp step 7)
	if (T == TEXT("lens") && City)
	{
		TMap<FString, double> Vals;
		const TSharedPtr<FJsonObject>* VO = nullptr;
		if (O->TryGetObjectField(TEXT("v"), VO) && VO && VO->IsValid())
			for (const TPair<FString, TSharedPtr<FJsonValue>>& E : (*VO)->Values) Vals.Add(E.Key, E.Value->AsNumber());
		City->SetLens(K, Vals);
		return;
	}
	// a row or a notice that names a building: the camera goes to it
	if (T == TEXT("fly") && City)
	{
		FString Bbl;
		O->TryGetStringField(TEXT("bbl"), Bbl);
		if (const FBWParcel* P = City->GetCity().FindParcel(Bbl))
			if (P->Ring.Num() && Cast<ABWCameraPawn>(PC->GetPawn()))
			{
				FVector2D C(0, 0);
				for (const FVector2D& Q : P->Ring) C += Q;
				C /= P->Ring.Num();
				ABWCameraPawn* Pawn = Cast<ABWCameraPawn>(PC->GetPawn());
				Pawn->SetView(FVector(C, 0), Pawn->Yaw, -40, FMath::Clamp(Pawn->Distance, 12000.0, 40000.0));
			}
		return;
	}
	if (T == TEXT("preview-rect"))
	{
		double H = 0;
		O->TryGetNumberField(TEXT("h"), H);
		if (ABWCameraPawn* Pawn = Cast<ABWCameraPawn>(PC->GetPawn())) Pawn->SetDeskRect(FVector4(X, Y, W, H));
		return;
	}
	if (T == TEXT("preview-orbit"))
	{
		if (ABWCameraPawn* Pawn = Cast<ABWCameraPawn>(PC->GetPawn()))
		{
			Pawn->DeskYaw += Dx * 0.3;
			// and up and down: from a kerb-height look (-3) to nearly overhead (-80)
			if (Dy != 0) Pawn->DeskPitch = FMath::Clamp((Pawn->DeskPitch != 0 ? Pawn->DeskPitch : -20.0) - Dy * 0.25, -80.0, -3.0);
			Pawn->DeskHeld = 4.0;
		}
		return;
	}
	PC->PageInput(O->GetStringField(TEXT("t")), X, Y, Dx, Dy, W, K);
}

void ABWGameMode::SetSeason(int32 Month)
{
	// THE YEAR, IN DAYLIGHT. Each game month is a day in the middle of it, seen
	// some time between late morning and mid-afternoon, at the generator's
	// latitude (41 N). The sun is placed by the solar geometry of that day and
	// hour, so a December street is in long low light and a June street under a
	// high sun. The weather is the month's own, drawn from the climate of a
	// mid-Atlantic port (about a third of days wet, winter greyer than summer)
	// by the month's number, so a month always looks the same when revisited.
	if (!Sun || Month == SkyMonth) return;
	SkyMonth = Month;
	const int32 M = ((Month % 12) + 12) % 12;
	const uint32 H = GetTypeHash(Month) * 2654435761u ^ 0x5bd1e995u;
	auto U = [H](int32 k) { return float(((H >> (k * 7)) ^ (H * (k + 3))) % 10007u) / 10007.f; };

	// ---- the sun: declination for the 15th of the month, hour 11:00-15:00
	const double Doy = 15 + 30.4 * M;
	const double Decl = FMath::DegreesToRadians(23.44 * FMath::Sin(2 * PI * (Doy - 81) / 365.0));
	const double Lat = FMath::DegreesToRadians(41.0);
	// afternoon, 1:30 to 4:30: a sun low enough to model a facade, still plainly day
	const double Hour = 13.5 + 3.0 * U(0);
	const double HA = FMath::DegreesToRadians(15.0 * (Hour - 12.0));
	const double SinEl = FMath::Sin(Lat) * FMath::Sin(Decl) + FMath::Cos(Lat) * FMath::Cos(Decl) * FMath::Cos(HA);
	const double El = FMath::Asin(SinEl);
	double Az = FMath::Acos(FMath::Clamp((FMath::Sin(Decl) - SinEl * FMath::Sin(Lat)) / (FMath::Cos(El) * FMath::Cos(Lat)), -1.0, 1.0));
	if (HA > 0) Az = 2 * PI - Az;                       // afternoon: west of south
	// the city's +X is north, +Y east: a sun at azimuth Az (clockwise from north)
	// shines toward Az + 180
	const double ElDeg = FMath::RadiansToDegrees(El), AzDeg = FMath::RadiansToDegrees(Az);
	Sun->SetActorRotation(FRotator(-ElDeg, AzDeg + 180.0, 0));

	// ---- the weather. A month is shown as ONE day, so its weather is the
	// month's typical afternoon, not the chance of any rain at all: a third of
	// days see some precipitation in a mid-Atlantic port, but it rains on an
	// afternoon far less often than that, and painting a whole month wet for
	// it put more than half the game under grey skies. Wet afternoons ~0.14
	// (more in winter), dry overcast 0.16 Nov-Mar and 0.08 May-Sep, partly
	// cloudy 0.34, the rest clear.
	const bool bWinter = M <= 2 || M >= 10, bSummer = M >= 4 && M <= 8;
	const float PWet = bWinter ? 0.16f : 0.12f, POver = bWinter ? 0.16f : bSummer ? 0.08f : 0.12f, PPart = 0.34f;
	const float R = U(1);
	enum { Clear, Partly, Overcast, Rain } Wx = R < PWet ? Rain : R < PWet + POver ? Overcast : R < PWet + POver + PPart ? Partly : Clear;
	// -Weather=clear|partly|overcast|rain: hold the weather (shots, testing)
	FString Force;
	if (FParse::Value(FCommandLine::Get(), TEXT("Weather="), Force))
		Wx = Force == TEXT("rain") ? Rain : Force == TEXT("overcast") ? Overcast : Force == TEXT("partly") ? Partly : Clear;
	Weather = Wx == Rain ? (bWinter && U(2) < 0.35f ? TEXT("snow showers") : TEXT("rain")) : Wx == Overcast ? TEXT("overcast") : Wx == Partly ? TEXT("partly cloudy") : TEXT("clear");

	// direct sun on the ground: ~120,000 lux times the air mass's transmission
	// (clear), a tenth of it through a full overcast; the sky's share rises as
	// the direct falls
	// (the overcast is a bright one, the white sky of a high cloud deck that
	// lights a street evenly, not the dark grey of a storm)
	const float Clearness = Wx == Clear ? 1.f : Wx == Partly ? 0.85f : Wx == Overcast ? 0.18f : 0.08f;
	const float Direct = 120000.f * FMath::Max(0.05f, float(SinEl)) * FMath::Pow(0.7f, float(1.0 / FMath::Max(0.1, SinEl)) * 0.678f);
	if (UDirectionalLightComponent* L = Cast<UDirectionalLightComponent>(Sun->GetLightComponent()))
	{
		L->SetIntensity(FMath::Max(2000.f, Direct * Clearness));
		L->SetTemperature(ElDeg < 20 ? 4800.f : ElDeg < 35 ? 5100.f : 5400.f);   // afternoon light: a little warm, warmer as it lowers
		L->SetLightSourceAngle(Wx >= Overcast ? 8.f : 0.5357f);   // overcast: a soft, shadowless sun
	}
	// the sky fills the shade: a blue sky lights a street's shadow side well
	if (SkyLight) SkyLight->SetIntensity(Wx == Clear ? 12000.f : Wx == Partly ? 12500.f : Wx == Overcast ? 12000.f : 9000.f);
	if (CloudMat)
	{
		// coverage is a bias on the cloud pattern (the material default, -0.2, is a
		// broken sky) and density is the cloud's thickness (default 0.008)
		CloudMat->SetScalarParameterValue(TEXT("Cloud_GlobalCoverage"), Wx == Clear ? -0.5f : Wx == Partly ? -0.2f : Wx == Overcast ? 0.35f : 0.5f);
		CloudMat->SetScalarParameterValue(TEXT("Cloud_GlobalDensity"), Wx == Clear ? 0.005f : Wx == Partly ? 0.008f : Wx == Overcast ? 0.012f : 0.016f);
		CloudMat->SetScalarParameterValue(TEXT("StormClouds"), Wx == Rain ? 0.4f : 0.f);
	}
	if (Fog)
	{
		Fog->GetComponent()->SetFogDensity(Wx == Rain ? 0.005f : Wx == Overcast ? 0.0028f : bSummer ? 0.0012f : 0.0009f);
	}
	if (Post)
	{
		// the meter follows the light: sunny 16 in sun, two to three stops down under cloud
		FPostProcessSettings& S = Post->Settings;
		// half a stop under the meter: pale stone and white glazing were clipping
		// ONE EXPOSURE PER SKY, set, not hunted for. The meter used to roam a two-
		// stop window and adapt at the engine's pace, so every change of month
		// opened nearly black and brightened over the month. A photographer sets
		// the exposure for the light: sunny 16 in sun (EV 14-15, the summer sun a
		// little brighter), two to three stops less under cloud and rain. The
		// month then reads in the light itself — the sun's height and colour,
		// the cloud, the lawn — and not in the screen dimming and recovering.
		// (set for the street, not the brightest stone: a city photographed for
		// how it feels to walk is exposed half a stop to a stop over the meter
		// on sunlit stone, and a grey day is lifted too, as an eye does)
		const float Ev = Wx == Clear ? (ElDeg > 45 ? 14.3f : 13.8f) : Wx == Partly ? (ElDeg > 45 ? 14.0f : 13.5f) : Wx == Overcast ? 11.6f : 11.1f;
		S.AutoExposureMinBrightness = Ev;
		S.AutoExposureMaxBrightness = Ev;
		S.bOverride_AutoExposureSpeedUp = S.bOverride_AutoExposureSpeedDown = true;
		S.AutoExposureSpeedUp = S.AutoExposureSpeedDown = 20.f;
		// THE GRADE. A photograph of a city is never the raw exposure: a touch more
		// colour and contrast, highlights a little warm, shadows a little cool
		// (the sky lights the shade), and the corners eased down.
		// AND THE SEASON IN IT: winter light is thin and blue in the shade, the
		// colour drained out of everything; summer is warm and full, autumn
		// golden in the highlights; spring sits between.
		const bool bAutumn = M >= 8 && M <= 10;
		const float SeasonSat = bWinter && !bAutumn ? 0.94f : bSummer ? 1.08f : 1.02f;
		const float Sat = (Wx >= Overcast ? 1.1f : 1.2f) * SeasonSat;
		S.bOverride_ColorSaturation = true;
		S.ColorSaturation = FVector4(Sat, Sat, Sat, 1);
		S.bOverride_ColorContrast = true;
		S.ColorContrast = FVector4(1.03f, 1.03f, 1.03f, 1);
		S.bOverride_ColorGainHighlights = true;
		S.ColorGainHighlights = bWinter && !bAutumn ? FVector4(1.0f, 1.0f, 0.98f, 1) : bAutumn ? FVector4(1.06f, 1.01f, 0.92f, 1) : FVector4(1.04f, 1.0f, 0.94f, 1);
		S.bOverride_ColorGainShadows = true;
		S.ColorGainShadows = bWinter && !bAutumn ? FVector4(0.97f, 0.99f, 1.06f, 1) : FVector4(1.0f, 1.0f, 1.03f, 1);
		// and the shadows lifted a little off black: a bright day's shade is never ink
		S.bOverride_ColorOffsetShadows = true;
		S.ColorOffsetShadows = FVector4(0.012f, 0.012f, 0.014f, 0);
		S.bOverride_VignetteIntensity = true;
		S.VignetteIntensity = 0.12f;
		// THE SHADE SIDE OF THE STREET. Exposed for the sun, a street in a
		// building's shadow fell five stops under it and printed black: the
		// pavement, the parked cars, the walkers, all gone. An eye (and any
		// photograph of a city worth looking at) holds both: local exposure
		// lifts the shade toward the middle without flattening the sunlit
		// faces, and a little sky leaks into Lumen's canyons, where the real
		// thing gets it from bounce off the facades opposite.
		// (-NoStreetLook: off, for a perf A/B)
		const bool bLift = !FParse::Param(FCommandLine::Get(), TEXT("NoStreetLook"));
		S.bOverride_LocalExposureShadowContrastScale = bLift;
		S.LocalExposureShadowContrastScale = Wx >= Overcast ? 0.75f : 0.5f;
		S.bOverride_LocalExposureHighlightContrastScale = bLift;
		S.LocalExposureHighlightContrastScale = 0.85f;
		S.bOverride_LumenSkylightLeaking = bLift;
		S.LumenSkylightLeaking = Wx >= Overcast ? 0.08f : 0.14f;
	}
	// THE SKY'S HAZE BY SEASON. The engine's default atmosphere is a mountain
	// sky, deep blue to the horizon; a harbour city's summer sky is milky with
	// moisture and the far shore goes soft in it, while a winter high is crisp.
	if (Atmosphere)
	{
		const float Haze = bSummer ? 1.5f : bWinter ? 1.0f : 1.25f;
		Atmosphere->SetMieScatteringScale(0.003996f * Haze * (Wx >= Overcast ? 1.4f : 1.f));
	}
	// streets wet in rain, damp for a while after it in the grey months
	ACityBuilder::SetSeasonGrass(M);
	ACityBuilder::SetWetness(Wx == Rain ? 1.f : Wx == Overcast && bWinter ? 0.45f : 0.f);
	static const TCHAR* const Months[12] = { TEXT("Jan"), TEXT("Feb"), TEXT("Mar"), TEXT("Apr"), TEXT("May"), TEXT("Jun"), TEXT("Jul"), TEXT("Aug"), TEXT("Sep"), TEXT("Oct"), TEXT("Nov"), TEXT("Dec") };
	UE_LOG(LogTemp, Display, TEXT("sky: month %d (%s), %.1f h, sun %.0f deg up at %.0f, %s"), Month, Months[M], Hour, ElDeg, AzDeg, *Weather);
}
