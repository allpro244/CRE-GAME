// Phase 1: the city as blocks. Every building tier is extruded from its
// footprint to its height and coloured by use; the ground is laid flat in
// layers (water, land, streets, sidewalks, parks); trees are instances.
// Phase 3 replaces the prisms with City Sample buildings.
#pragma once

#include "CityData.h"
#include "RenderView.h"
#include "FacadeBuilder.h"
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
	virtual void Tick(float Dt) override;

	/** Load a bw-city/1 file and build it. */
	bool BuildFromFile(const FString& Path);
	/** Build from a bw-city/1 document in memory. */
	bool BuildFromText(const FString& Text);

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
	/** Who owns a lot as of the last render view: "player", a rival firm id, or empty. */
	FString OwnerOf(const FString& Bbl) const { return Owners.FindRef(Bbl); }

private:
	void BuildGround();
	void BuildVolumes();
	void BuildTrees();
	/** Lane lines, double yellow centres and zebra crossings, painted just above the asphalt. */
	void BuildMarkings();
	/** Phase 3 traffic (first cut): cars driving the lane centrelines, right-hand, at
	 *  city speeds; each lane's cars wrap at its ends. Full Mass/ZoneGraph traffic later. */
	void BuildTraffic();
	struct FLane { TArray<FVector2D> Pts; TArray<double> Cum; double Len = 0; };
	struct FCar { int32 Lane = 0, Mesh = 0, Instance = 0; double S = 0, Speed = 0; };
	TArray<FLane> Lanes;
	TArray<FCar> Cars;
	UPROPERTY()
	TArray<TObjectPtr<UInstancedStaticMeshComponent>> TrafficMeshes;

	FBWCity City;
	/** Phase 3: the facade kit, when Data/kit-*.json and its meshes are present. */
	TArray<FBWKit> Kits;
	bool bFacades = false;
	/** Which kit dresses this volume: by use, era and height, varied by lot. */
	const FBWKit* KitFor(const FBWVolume& V) const;
	/** Data/facade-families.json: the kits each web facade family can wear, and each later family's original. */
	TMap<FString, TArray<FString>> FamilyKits;
	TMap<FString, FString> FamilyLike;
	TUniquePtr<FBWFacadeBuilder> Facades;
	/** What stands now: the generator's volumes minus overridden lots, plus the economy's. */
	TArray<FBWVolume> Current;
	TArray<FVector> Sites;
	TMap<FString, FString> Owners;

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

	/** City Sample props (trees, lamps, rooftop plant), instanced per mesh. Street props
	 *  persist; roof props are rebuilt with the buildings they stand on. */
	void AddProp(const TCHAR* Path, const FTransform& T, bool bRoof);
	void ClearRoofProps();
	void BuildStreetProps();
	void DressRoof(const FBWVolume& V, uint32 Seed);
	void ParkLot(const FBWVolume& V, uint32 Seed);
	void StreetMoment(const FBWVolume& V);
	UPROPERTY()
	TMap<FString, TObjectPtr<UInstancedStaticMeshComponent>> StreetProps;
	UPROPERTY()
	TMap<FString, TObjectPtr<UInstancedStaticMeshComponent>> RoofProps;
};
