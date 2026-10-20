// Phase 3: dress a building volume in a City Sample facade kit.
//
// The kit table (unreal/tools/kit-table.mjs -> Data/kit-<KIT>.json) is Epic's
// own shape grammar for the kit, read as data: floor bands bottom to top, one of
// them repeating, each a run of wall modules between corners. For a volume this
// lays the bands up its height (stretching the repeating band so the stack lands
// exactly on the volume's roof) and, on every footprint edge, a corner then
// equal-width wall modules (one module grid per edge, shared by every band, so
// the windows line up floor to floor). Every piece is an instance of a Nanite
// mesh; nothing here is an asset of ours.
#pragma once

#include "CoreMinimal.h"

class UStaticMesh;
class UInstancedStaticMeshComponent;
class USceneComponent;
struct FBWVolume;

struct FBWKitModule
{
	FString Path;
	double Width = 400, Depth = 100, Y0 = -400, Y1 = 0;
	UStaticMesh* Mesh = nullptr;
	/** The piece's weathering layer (City Sample's "_decal" companion: grime, stains, wear), when it has one. */
	UStaticMesh* Decal = nullptr;
};

struct FBWKitBand
{
	FString Symbol;
	double Height = 0;
	bool bRepeat = false;
	/** The street floor: only a volume that starts at the ground gets it. */
	bool bGround = false;
	TArray<FBWKitModule> Walls, Entrances;
	FBWKitModule Corner;
	bool bHasCorner = false;
};

struct FBWKit
{
	FString Name;
	TArray<FBWKitBand> Bands;
	/** The kit's module grid along a facade: its repeating band's wall width. */
	double Grid = 400;
	bool Load(const FString& Path);
};

class FBWFacadeBuilder
{
public:
	/** Owner gets one instanced component per mesh, created on demand. */
	explicit FBWFacadeBuilder(USceneComponent* InParent) : Parent(InParent) {}

	void Reset();
	/** Lay the kit over this volume. Returns the number of pieces placed. */
	int32 Dress(const FBWKit& Kit, const FBWVolume& V, uint32 Seed, bool bGround);

	int32 Pieces() const { return Placed; }

private:
	UInstancedStaticMeshComponent* Comp(UStaticMesh* Mesh);
	void Put(const FBWKitModule& M, const FVector2D& A, const FVector2D& D, const FVector2D& Out, double S, double W, double Z, double ScaleZ);

	USceneComponent* Parent;
	TMap<UStaticMesh*, UInstancedStaticMeshComponent*> Comps;
	int32 Placed = 0;
};

/** The footprint pulled in by Inset cm along each corner's bisector (for a backing mass behind the facade). */
TArray<FVector2D> BWInsetRing(const TArray<FVector2D>& Ring, double Inset);
