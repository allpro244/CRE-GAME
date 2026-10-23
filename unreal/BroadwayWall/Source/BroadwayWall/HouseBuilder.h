// AMERICAN HOUSES, FROM THE KIT. Every volume with deco "house" (the region's
// neighbourhoods, a town's residential additions) becomes a house of its era:
// a bungalow or a foursquare before the Depression, a Cape in the 1940s, ranches
// after the war, split-levels in the 1960s-70s, colonials from the late 1970s,
// the modern farmhouse lately (tools/make-homes.py). Each is fitted to its
// footprint and turned to face its street, wears an era's siding, brick or
// stucco and shingles, and gets its driveway to the kerb, a detached garage out
// back on the older lots, and a car or two at home.
#pragma once

#include "CoreMinimal.h"
#include "CityData.h"
#include "RetailBuilder.h"

class FBWHouseBuilder
{
public:
	explicit FBWHouseBuilder(USceneComponent* InParent) : Kit(InParent) {}

	/** Whether the house meshes are in Content (tools/make-homes.py has been run). */
	static bool Available();
	/** Before a laying: the streets (to face) and every house (so a garage or driveway does not land on a neighbour). FootZ: the lawns' top, cm. */
	void Prepare(const FBWCity& City, const TArray<FBWVolume>& Volumes, double FootZ);
	/** Lay one house. */
	void Dress(const FBWVolume& V, uint32 Seed);
	void Reset() { Kit.Reset(); }

	FBWKitSet Kit;
	int32 Houses = 0;

private:
	struct FSeg { FVector2D A, B; double W; };
	TMap<FIntPoint, TArray<FSeg>> Streets;
	TMap<FIntPoint, TArray<TArray<FVector2D>>> Homes;
	double GroundZ = 20;
	/** The nearest street to P within ~60 m: its nearest point and carriageway width. */
	bool NearestStreet(const FVector2D& P, FVector2D& Q, double& Width) const;
	/** Whether P stands inside another house's footprint (not Own). */
	bool OnNeighbour(const FVector2D& P, const TArray<FVector2D>& Own) const;
};
