// The dynamic half of the render contract ("bw-render/1"): what stands on each
// lot this month. Mirrors broadway-and-wall/src/engine/renderView.ts field for
// field; test/render-view.mjs checks the TypeScript side against this header.
#pragma once

#include "CoreMinimal.h"
#include "CityData.h"

struct FBWRenderLot
{
	FString Bbl, Cls;
	int32 Floors = 0;
	double HeightM = 0;
	bool bConstruction = false;
	double Progress = 1;
	double Cov = -1;      // < 0: not kept by the engine
	int32 Year = 0;
	bool bFresh = false;
	bool bShops = false;
	FString Facade;   // the player's chosen facade family, if they designed it
	FBWLook Look;     // and the kit look they chose on the Build desk
};

struct FBWRenderOwner
{
	FString Bbl, Owner, Firm; // Owner: "player" | "rival"
	bool bListed = false;
	int32 Distress = 0;       // 1 swept, 2 workout
};

struct FBWRenderEvent
{
	int32 M = 0;
	FString Bbl, Kind;
};

struct FBWRenderView
{
	int32 Month = 0, Year = 0;
	FString Phase;
	TArray<FBWRenderLot> Lots;
	TArray<FBWRenderOwner> Owners;
	TMap<FString, FString> Merged; // child deed -> parent lot
	TArray<FBWRenderEvent> Events;

	/** Parse a bw-render/1 JSON object (as text). */
	bool Parse(const FString& Json);
};
