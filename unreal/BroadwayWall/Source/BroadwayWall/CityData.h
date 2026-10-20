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

/** THE PLAYER'S LOOK for a building they designed (BuildingDesign kit fields):
 *  which facade kit, its wall colour, how it meets the street, how it finishes
 *  at the top, and its window rhythm. Empty fields leave the automatic choice. */
struct FBWLook
{
	FString Kit;
	bool bTint = false;
	FLinearColor Tint = FLinearColor::White;
	/** "shops" (the kit's shopfront floor), "entrance" (doors along it), "plain" (the upper floors run to the pavement) */
	FString Ground;
	/** "cornice" (the kit's top bands) or "plain" (stop at the last floor) */
	FString Top;
	/** index into the facade builder's bay rhythms; < 0 picks by lot */
	int32 Bays = -1;
	bool IsSet() const { return !Kit.IsEmpty(); }
};
/** Read a "look" object ({ kit, tint: [r,g,b], ground, top, bays }); returns an unset look when absent. */
FBWLook BWReadLook(const TSharedPtr<class FJsonObject>& Parent, const TCHAR* Field = TEXT("look"));

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
	/** The player's facade family (web BuildingDesign.facade), which picks the kit. */
	FString Facade;
	/** The web map's facade family for this building (map/real/facades.ts familyFor) and its wall tint, an RGB multiplier. */
	FString Fam;
	FLinearColor Tint = FLinearColor::White;
	FBWLook Look;
	TArray<FVector2D> Ring;
};

/** A street's centreline and the carriageway width the markings divide into lanes. */
struct FBWCenterline
{
	double Width = 800;   // cm, kerb to kerb
	int32 Mark = 0;
	FString Cls;
	TArray<FVector2D> Line;
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
	TArray<FBWCenterline> Centerlines;
	TArray<TArray<FVector2D>> Zebras;
	/** The generator's kerb lines (a footway's road edge), lawn edgings and park walks. */
	TArray<TArray<FVector2D>> Curbs, ParkKerbs, ParkPaths;
	/** Park and harbour benches: where, and the generator's bearing (degrees, its local frame: the walk's direction; the seat faces +90). */
	TArray<TPair<FVector2D, double>> Benches;

	/** Parse a bw-city/1 file. Returns false (and logs why) on failure. */
	bool Load(const FString& Path);
	/** The same, from a document already in memory (the game sends its city over the bridge). */
	bool LoadText(const FString& Text, const FString& Label);
	const FBWParcel* FindParcel(const FString& Bbl) const;
};
