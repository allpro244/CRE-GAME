#include "BWGame.h"

#include "Camera/CameraComponent.h"
#include "CityBuilder.h"
#include "Components/DirectionalLightComponent.h"
#include "Components/SkyLightComponent.h"
#include "DrawDebugHelpers.h"
#include "Engine/Canvas.h"
#include "Engine/DirectionalLight.h"
#include "Engine/Engine.h"
#include "Engine/ExponentialHeightFog.h"
#include "Engine/Font.h"
#include "Engine/GameViewportClient.h"
#include "Engine/SkyLight.h"
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
#include "IWebSocket.h"
#include "WebSocketsModule.h"
#include "RenderView.h"
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

void ABWCameraPawn::Tick(float Dt)
{
	Super::Tick(Dt);
	Pitch = FMath::Clamp(Pitch, -89.0, -8.0);
	Distance = FMath::Clamp(Distance, MinDistance, MaxDistance);
	const FRotator Rot(Pitch, Yaw, 0);
	SetActorLocationAndRotation(Focus - Rot.Vector() * Distance, Rot);
}

void ABWCameraPawn::Pan(const FVector2D& Dir, double Dt)
{
	// faster when high up: a screen's width a second-ish
	const double Speed = Distance * 0.9;
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

	FVector2D Dir(0, 0);
	if (IsInputKeyDown(EKeys::W) || IsInputKeyDown(EKeys::Up)) Dir.Y += 1;
	if (IsInputKeyDown(EKeys::S) || IsInputKeyDown(EKeys::Down)) Dir.Y -= 1;
	if (IsInputKeyDown(EKeys::D) || IsInputKeyDown(EKeys::Right)) Dir.X += 1;
	if (IsInputKeyDown(EKeys::A) || IsInputKeyDown(EKeys::Left)) Dir.X -= 1;
	if (!Dir.IsZero()) Cam->Pan(Dir.GetSafeNormal(), Dt);
	if (IsInputKeyDown(EKeys::Q)) Cam->Yaw -= 70 * Dt;
	if (IsInputKeyDown(EKeys::E)) Cam->Yaw += 70 * Dt;
	if (WasInputKeyJustPressed(EKeys::MouseScrollUp)) Cam->Zoom(1);
	if (WasInputKeyJustPressed(EKeys::MouseScrollDown)) Cam->Zoom(-1);

	if (IsInputKeyDown(EKeys::RightMouseButton))
	{
		float Dx, Dy;
		GetInputMouseDelta(Dx, Dy);
		Cam->Yaw += Dx * 0.25;
		Cam->Pitch += Dy * 0.25;
	}
	if (WasInputKeyJustPressed(EKeys::LeftMouseButton))
	{
		float X, Y;
		if (GetMousePosition(X, Y)) Select(PickAt(FVector2D(X, Y)));
	}
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
	ADirectionalLight* Sun = W->SpawnActor<ADirectionalLight>(FVector(0, 0, 100000), FRotator(-38, 125, 0));
	Sun->GetRootComponent()->SetMobility(EComponentMobility::Movable);
	if (UDirectionalLightComponent* L = Cast<UDirectionalLightComponent>(Sun->GetLightComponent()))
	{
		L->SetIntensity(8.f);
		L->SetAtmosphereSunLight(true);
		L->SetDynamicShadowDistanceMovableLight(400000.f);
	}
	AActor* Atmos = W->SpawnActor<AActor>();
	USkyAtmosphereComponent* SA = NewObject<USkyAtmosphereComponent>(Atmos, TEXT("SkyAtmosphere"));
	Atmos->SetRootComponent(SA);
	SA->RegisterComponent();
	ASkyLight* Sky = W->SpawnActor<ASkyLight>();
	Sky->GetLightComponent()->SetMobility(EComponentMobility::Movable);
	Sky->GetLightComponent()->bRealTimeCapture = true;
	Sky->GetLightComponent()->SetIntensity(1.f);
	Sky->GetLightComponent()->RecaptureSky();
	AExponentialHeightFog* Fog = W->SpawnActor<AExponentialHeightFog>();
	(void)Fog;
}

void ABWGameMode::BeginPlay()
{
	Super::BeginPlay();
	SpawnSky();

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
	if (FParse::Value(FCommandLine::Get(), TEXT("Sim="), SimUrl)) StartSim(SimUrl);
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

	struct FShot { FString Name; FVector Focus; double Yaw, Pitch, Dist; bool bPick; };
	TArray<FShot> Shots = {
		{ TEXT("01-overview"), Mid, 0, -60, Span * 1.0, false },
		{ TEXT("02-oblique"), Mid, 35, -28, Span * 0.75, false },
		{ TEXT("03-downtown"), Tall, 210, -22, 90000, false },
		{ TEXT("04-low"), Tall + FVector(-20000, 4000, 0), 25, -16, 45000, false },
		{ TEXT("05-picked"), Tall, 300, -35, 60000, true },
	};
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
			Cam->SetView(S.Focus, S.Yaw, S.Pitch, S.Dist);
			PC->Select(nullptr);
		}
		else if (Beat == 1 && S.bPick)
		{
			int32 W, H;
			PC->GetViewportSize(W, H);
			PC->Select(PC->PickAt(FVector2D(W * 0.5, H * 0.5)));
		}
		else if (Beat == 2) Self->SaveWindowShot(Dir / (S.Name + TEXT(".png")));
		++*Step;
	}, 1.0f, true, 4.0f);
}
