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
class UMaterialInterface;
class UMaterialInstanceDynamic;
class USceneComponent;
struct FBWVolume;

struct FBWKitModule
{
	FString Path;
	double Width = 400, Depth = 100, Y0 = -400, Y1 = 0;
	UStaticMesh* Mesh = nullptr;
	/** The piece's weathering layer (City Sample's "_decal" companion: grime, stains, wear), when it has one. */
	UStaticMesh* Decal = nullptr;
	/** A feature bay (a fire escape, an oriel): used on one bay in Every along each wall, never by the rhythm. 0 = an ordinary bay. */
	int32 Every = 0;
	/** A facade zone (0, 1, 2...): a kit with zones splits each wall into runs of bays, each run in one zone's cladding. -1 = unzoned. */
	int32 Zone = -1;
	/** Pieces that differ only in their blinds share a Mix group; one is picked per bay per floor. Variants stay out of the palette. */
	int32 Mix = -1;
	bool bVariant = false;
};

struct FBWKitBand
{
	FString Symbol;
	double Height = 0;
	bool bRepeat = false;
	/** The street floor: only a volume that starts at the ground gets it. */
	bool bGround = false;
	/** Floors the band spans when the kit says (a two-storey shaft piece staggers its balconies); 0 = from its height. */
	int32 Storeys = 0;
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
	/** bExactTint: the tint is the player's chosen colour, used as given (the web families' tints are amplified). */
	int32 Dress(const FBWKit& Kit, const FBWVolume& V, uint32 Seed, bool bGround, const FLinearColor& Tint = FLinearColor::White, bool bExactTint = false);
	/** Which of the next volume's walls stand on a lot line against a neighbour (one per ring edge); those get no facade. Cleared by Dress. */
	TArray<bool> Party;

	int32 Components() const { return Comps.Num(); }
	int32 Pieces() const { return Placed; }

private:
	UInstancedStaticMeshComponent* Comp(UStaticMesh* Mesh, bool bTinted = true);
	void Put(const FBWKitModule& M, const FVector2D& A, const FVector2D& D, const FVector2D& Out, double S, double W, double Z, double ScaleZ);

	USceneComponent* Parent;
	/** One component per mesh and tint: a wall tint is a material parameter, so it is per component. */
	TMap<TPair<UStaticMesh*, uint32>, UInstancedStaticMeshComponent*> Comps;
	/** The kit's wall material at each tint (Color Tint/Mult(A) M1 scaled), shared by every mesh using it. */
	TMap<TPair<UMaterialInterface*, uint32>, UMaterialInstanceDynamic*> Tinted;
	/** The tint being laid now, quantised to a 0.04 grid (the web's tints sit on 0.02; coarser keeps the component count down). */
	uint32 TintKey = 0;
	/** This building's weathering level, 0 (new) to 3 (a century old), in the top byte of TintKey. */
	int32 GrimeNow = 0;
	FLinearColor TintNow = FLinearColor::White;
	int32 Placed = 0;
};

/** The footprint pulled in by Inset cm along each corner's bisector (for a backing mass behind the facade). */
TArray<FVector2D> BWInsetRing(const TArray<FVector2D>& Ring, double Inset);
