// The city as exported by unreal/tools/export-city.mjs ("bw-city/1").
// Units are centimetres, +X north, +Y east, origin at the city's centre.
#pragma once

#include "CoreMinimal.h"

struct FBWParcel
{
	FString Bbl, Address, District, DistrictName, Zone, Cls;
	int32 Floors = 0, YearBuilt = 0;
	double LotArea = 0, BldgArea = 0;
	TArray<FVector2D> Ring;
};

/** One extruded prism: a building tier, a crown, a piece of dressing, or a flat vacant lot. */
struct FBWVolume
{
	FString Bbl, Cls, Deco;
	int32 Year = 0;
	double Z0 = 0, Z1 = 0;
	/** The top tier of its building (the generator's "crown": the volume whose roof is the roof). */
	bool bCrown = false, bVacant = false;
	/** Set by the live economy (RenderView): a frame going up; the player owns it. */
	bool bFrame = false, bPlayer = false;
	/** Walls only, no roof (site hoarding). */
	bool bOpen = false;
	/** Phase 4 set-pieces: opened in the last three months (bunting); a lender has a workout file open (barricade). */
	bool bFresh = false;
	int32 Distress = 0;
	TArray<FVector2D> Ring;
};

struct FBWLabel
{
	FString Name, Kind;
	FVector2D At;
};

struct FBWCity
{
	FString Name, Size;
	int64 Seed = 0;
	FBox2D Bounds = FBox2D(ForceInit);
	TArray<FBWParcel> Parcels;
	TMap<FString, int32> ParcelByBbl;
	TArray<FBWVolume> Volumes;
	TArray<TArray<FVector2D>> Water;
	/** Ground layers in draw order (later on top). */
	TArray<TPair<FString, TArray<TArray<FVector2D>>>> Ground;
	TArray<FVector2D> Trees;
	TArray<FBWLabel> Labels;

	/** Parse a bw-city/1 file. Returns false (and logs why) on failure. */
	bool Load(const FString& Path);
	/** The same, from a document already in memory (the game sends its city over the bridge). */
	bool LoadText(const FString& Text, const FString& Label);
	const FBWParcel* FindParcel(const FString& Bbl) const;
};
