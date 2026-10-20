// Phase 1: the city as blocks. Every building tier is extruded from its
// footprint to its height and coloured by use; the ground is laid flat in
// layers (water, land, streets, sidewalks, parks); trees are instances.
// Phase 3 replaces the prisms with City Sample buildings.
#pragma once

#include "CityData.h"
#include "RenderView.h"
#include "GameFramework/Actor.h"
#include "CityBuilder.generated.h"

class UProceduralMeshComponent;
class UInstancedStaticMeshComponent;
class UMaterialInterface;

UCLASS()
class ACityBuilder : public AActor
{
	GENERATED_BODY()
public:
	ACityBuilder();

	/** Load a bw-city/1 file and build it. */
	bool BuildFromFile(const FString& Path);

	/** The parcel a trace hit, if it hit a building or a lot. */
	const FBWParcel* ParcelFromHit(const FHitResult& Hit) const;
	/** The parcel under a ground point (X north, Y east, cm). */
	const FBWParcel* ParcelAt(const FVector2D& P) const;
	/** The tallest point of a parcel's volumes, in cm (for framing a selection). */
	double ParcelTop(const FString& Bbl) const;

	/** Redraw for this month: lots the economy changed replace the generator's buildings. */
	void ApplyView(const FBWRenderView& View);

	const FBWCity& GetCity() const { return City; }
	const TArray<FBWVolume>& GetVolumes() const { return Current; }
	/** Where frames are rising this month: base centre (cm), Z = crane top. */
	const TArray<FVector>& GetSites() const { return Sites; }

private:
	void BuildGround();
	void BuildVolumes();
	void BuildTrees();

	FBWCity City;
	/** What stands now: the generator's volumes minus overridden lots, plus the economy's. */
	TArray<FBWVolume> Current;
	TArray<FVector> Sites;

	UPROPERTY()
	TObjectPtr<UMaterialInterface> VertexColorMaterial;
	UPROPERTY()
	TArray<TObjectPtr<UProceduralMeshComponent>> Chunks;
	UPROPERTY()
	TObjectPtr<UInstancedStaticMeshComponent> Trees;
	/** Tower cranes over every frame going up: mast, jib, counter-jib, ballast. */
	UPROPERTY()
	TObjectPtr<UInstancedStaticMeshComponent> Cranes;
	void AddCrane(const TArray<FVector2D>& Footprint, double TopCm, uint32 Hash);
};
