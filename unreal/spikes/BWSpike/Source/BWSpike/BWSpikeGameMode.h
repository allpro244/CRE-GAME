// Phase 0 spikes. Run as a standalone game with one of:
//   -SpikeA=<url> -SpikeAScript=<path.js>   the web game in a full-window browser; the
//                                            script drives it and reports over the JS bridge
//   -SpikeB=<ws://host:port> [-SpikeBSize=metro]  the economy sidecar: build a town, advance 12 months
//   -ShotDir=<dir>                           where screenshots go (default Saved/Shots)
#pragma once

#include "GameFramework/GameModeBase.h"
#include "BWSpikeGameMode.generated.h"

class SWebBrowser;
class IWebSocket;

/** Bound into the page as window.ue.bridge — the JS -> C++ half of spike A. */
UCLASS()
class UBWBridge : public UObject
{
	GENERATED_BODY()
public:
	/** JS: window.ue.bridge.report("text"). "SHOT:<name>" saves a screenshot, "QUIT" ends the run. */
	UFUNCTION()
	void Report(const FString& Message);

	TFunction<void(const FString&)> OnReport;
};

UCLASS()
class ABWSpikeGameMode : public AGameModeBase
{
	GENERATED_BODY()
public:
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type Reason) override;

	/** Capture the whole game window, Slate and browser included, to <ShotDir>/<Name>.png. */
	void SaveWindowShot(const FString& Name);

private:
	void StartSpikeA(const FString& Url, const FString& ScriptPath);
	void StartSpikeB(const FString& Url);
	void SendNextB();
	void Note(const FString& Line);

	TSharedPtr<SWebBrowser> Browser;
	UPROPERTY()
	TObjectPtr<UBWBridge> Bridge;
	FString Script;

	TSharedPtr<IWebSocket> Socket;
	TArray<FString> PendingB;
	double SentAt = 0;
	TArray<FString> Lines;
};
