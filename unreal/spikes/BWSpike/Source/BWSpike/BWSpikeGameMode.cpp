#include "BWSpikeGameMode.h"

#include "Engine/Engine.h"
#include "Engine/GameViewportClient.h"
#include "Framework/Application/SlateApplication.h"
#include "HAL/PlatformTime.h"
#include "ImageCore.h"
#include "ImageUtils.h"
#include "IWebSocket.h"
#include "Misc/CommandLine.h"
#include "Misc/FileHelper.h"
#include "Misc/Parse.h"
#include "Misc/Paths.h"
#include "SWebBrowser.h"
#include "IWebBrowserWindow.h"
#include "TimerManager.h"
#include "WebSocketsModule.h"
#include "Widgets/SWindow.h"

DEFINE_LOG_CATEGORY_STATIC(LogBWSpike, Log, All);

void UBWBridge::Report(const FString& Message)
{
	UE_LOG(LogBWSpike, Display, TEXT("BRIDGE: %s"), *Message);
	if (OnReport) OnReport(Message);
}

static FString ShotDir()
{
	FString Dir;
	if (!FParse::Value(FCommandLine::Get(), TEXT("ShotDir="), Dir)) Dir = FPaths::ProjectSavedDir() / TEXT("Shots");
	return Dir;
}

void ABWSpikeGameMode::Note(const FString& Line)
{
	UE_LOG(LogBWSpike, Display, TEXT("%s"), *Line);
	Lines.Add(Line);
	if (GEngine) GEngine->AddOnScreenDebugMessage(-1, 600.f, FColor::White, Line, true, FVector2D(1.6f, 1.6f));
	FFileHelper::SaveStringArrayToFile(Lines, *(ShotDir() / TEXT("spike-log.txt")));
}

void ABWSpikeGameMode::BeginPlay()
{
	Super::BeginPlay();
	FString Url, ScriptPath;
	if (FParse::Value(FCommandLine::Get(), TEXT("SpikeA="), Url))
	{
		FParse::Value(FCommandLine::Get(), TEXT("SpikeAScript="), ScriptPath);
		StartSpikeA(Url, ScriptPath);
	}
	else if (FParse::Value(FCommandLine::Get(), TEXT("SpikeB="), Url))
	{
		StartSpikeB(Url);
	}
}

void ABWSpikeGameMode::EndPlay(const EEndPlayReason::Type Reason)
{
	if (Socket.IsValid()) Socket->Close();
	if (Browser.IsValid() && GEngine && GEngine->GameViewport) GEngine->GameViewport->RemoveAllViewportWidgets();
	Super::EndPlay(Reason);
}

void ABWSpikeGameMode::SaveWindowShot(const FString& Name)
{
	if (!GEngine || !GEngine->GameViewport) return;
	TSharedPtr<SWindow> Window = GEngine->GameViewport->GetWindow();
	if (!Window.IsValid()) return;
	TArray<FColor> Pixels;
	FIntVector Size;
	if (!FSlateApplication::Get().TakeScreenshot(Window.ToSharedRef(), Pixels, Size))
	{
		UE_LOG(LogBWSpike, Warning, TEXT("screenshot failed"));
		return;
	}
	for (FColor& C : Pixels) C.A = 255;
	const FString Path = ShotDir() / (Name + TEXT(".png"));
	FImageView View(Pixels.GetData(), Size.X, Size.Y);
	const bool bOk = FImageUtils::SaveImageByExtension(*Path, View);
	UE_LOG(LogBWSpike, Display, TEXT("SHOT %s %s (%dx%d)"), bOk ? TEXT("saved") : TEXT("FAILED"), *Path, Size.X, Size.Y);
}

// ---------------------------------------------------------------- spike A

void ABWSpikeGameMode::StartSpikeA(const FString& Url, const FString& ScriptPath)
{
	if (!ScriptPath.IsEmpty() && !FFileHelper::LoadFileToString(Script, *ScriptPath))
		Note(FString::Printf(TEXT("A: cannot read script %s"), *ScriptPath));

	Bridge = NewObject<UBWBridge>(this);
	TWeakObjectPtr<ABWSpikeGameMode> Self(this);
	Bridge->OnReport = [Self](const FString& M)
	{
		if (!Self.IsValid()) return;
		if (M.StartsWith(TEXT("SHOT:"))) Self->SaveWindowShot(M.Mid(5));
		else if (M == TEXT("QUIT"))
			Self->GetWorldTimerManager().SetTimerForNextTick([]() { FPlatformMisc::RequestExit(false); });
		else Self->Lines.Add(TEXT("A: ") + M), FFileHelper::SaveStringArrayToFile(Self->Lines, *(ShotDir() / TEXT("spike-log.txt")));
	};

	SAssignNew(Browser, SWebBrowser)
		.InitialURL(Url)
		.ShowControls(false)
		.ShowAddressBar(false)
		.ShowErrorMessage(true)
		.BrowserFrameRate(60)
		.OnConsoleMessage_Lambda([Self](const FString& Msg, const FString& Src, int32 Line, EWebBrowserConsoleLogSeverity)
		{
			UE_LOG(LogBWSpike, Display, TEXT("JS: %s  (%s:%d)"), *Msg.Left(400), *FPaths::GetCleanFilename(Src), Line);
			// fallback channel when the bridge is missing: console.log("BWCMD:SHOT:x")
			if (Self.IsValid() && Msg.StartsWith(TEXT("BWCMD:")) && Self->Bridge) Self->Bridge->OnReport(Msg.Mid(6));
		})
		.OnLoadCompleted_Lambda([Self]()
		{
			if (!Self.IsValid() || !Self->Browser.IsValid()) return;
			const FString Now = Self->Browser->GetUrl();
			Self->Note(FString::Printf(TEXT("A: load completed %s"), *Now));
			if (Now.StartsWith(TEXT("about:"))) return;
			// a cross-site navigation lands in a new renderer process that never
			// received the permanent binding; send it again for this page
			Self->Browser->UnbindUObject(TEXT("bridge"), Self->Bridge, true);
			Self->Browser->BindUObject(TEXT("bridge"), Self->Bridge, true);
			if (Self->Script.IsEmpty()) return;
			Self->Note(TEXT("A: injecting driver"));
			Self->Browser->ExecuteJavascript(Self->Script);
		})
		.OnLoadError_Lambda([Self]() { if (Self.IsValid()) Self->Note(TEXT("A: LOAD ERROR")); });

	Browser->BindUObject(TEXT("bridge"), Bridge, true);
	GEngine->GameViewport->AddViewportWidgetContent(Browser.ToSharedRef(), 100);
	FSlateApplication::Get().SetKeyboardFocus(Browser);
	Note(FString::Printf(TEXT("A: loading %s"), *Url));
}

// ---------------------------------------------------------------- spike B

void ABWSpikeGameMode::StartSpikeB(const FString& Url)
{
	FModuleManager::LoadModuleChecked<FWebSocketsModule>(TEXT("WebSockets"));
	Socket = FWebSocketsModule::Get().CreateWebSocket(Url);
	FString Size = TEXT("city");
	FParse::Value(FCommandLine::Get(), TEXT("SpikeBSize="), Size);
	PendingB.Add(FString::Printf(TEXT("{\"type\":\"town\",\"id\":1,\"size\":\"%s\"}"), *Size));
	for (int32 i = 0; i < 12; ++i) PendingB.Add(FString::Printf(TEXT("{\"type\":\"month\",\"id\":%d}"), i + 2));

	TWeakObjectPtr<ABWSpikeGameMode> Self(this);
	Socket->OnConnected().AddLambda([Self]() { if (Self.IsValid()) { Self->Note(TEXT("B: connected")); Self->SendNextB(); } });
	Socket->OnConnectionError().AddLambda([Self](const FString& E) { if (Self.IsValid()) Self->Note(TEXT("B: connection error ") + E); });
	Socket->OnMessage().AddLambda([Self](const FString& Msg)
	{
		if (!Self.IsValid()) return;
		const double Rtt = (FPlatformTime::Seconds() - Self->SentAt) * 1000.0;
		Self->Note(FString::Printf(TEXT("B: rtt %.0f ms  %s"), Rtt, *Msg));
		if (Self->PendingB.Num() > 0) Self->SendNextB();
		else
		{
			Self->Note(TEXT("B: done"));
			Self->GetWorldTimerManager().SetTimerForNextTick([Self]()
			{
				if (!Self.IsValid()) return;
				FTimerHandle H;
				Self->GetWorldTimerManager().SetTimer(H, [Self]()
				{
					if (!Self.IsValid()) return;
					Self->SaveWindowShot(TEXT("spikeB"));
					FPlatformMisc::RequestExit(false);
				}, 1.0f, false);
			});
		}
	});
	Note(FString::Printf(TEXT("B: connecting %s"), *Url));
	Socket->Connect();
}

void ABWSpikeGameMode::SendNextB()
{
	const FString M = PendingB[0];
	PendingB.RemoveAt(0);
	SentAt = FPlatformTime::Seconds();
	Socket->Send(M);
}
