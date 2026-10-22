// AMERICAN RETAIL, BUILT FROM A KIT. The region's shopping centres, strips and
// pads (region/commerce.mjs, volumes with a "role") drawn as the real thing: a
// strip centre's piers, storefronts, awnings and lit signs on a raised parapet
// with an entry tower; a grocery's tall glazed entrance; a big box's portal and
// truck docks; a fast-food pad's drive-through lane, a bank's teller canopy, a
// gas station's pump canopy; the centre's pylon sign.
//
// Two halves, so the kit extends to houses and sheds next:
//   FBWKitSet      instances real-size kit meshes (tools/make-kit.py: eight
//                  named material slots, recoloured per instanced component)
//                  and lit lettering, noting each so one building can be taken
//                  down alone;
//   FBWRetailBuilder  the retail grammar: from a volume's footprint, role and
//                  storefront, a plan (Mass: the body's prisms, which the city
//                  builder meshes into its tiles; Dress: the kit pieces).
#pragma once

#include "CoreMinimal.h"
#include "CityData.h"

class UInstancedStaticMeshComponent;
class UMaterialInterface;
class USceneComponent;
class UTextRenderComponent;

/** A prism the city builder meshes into its tile (walls and a flat top), in one of the builder's materials. */
struct FBWSolid
{
	int32 Mat = 0;
	TArray<FVector2D> Ring;
	double Z0 = 0, Z1 = 0;
	bool bTop = true;
};

/** A slot of a kit mesh recoloured: the slot's name (wall, trim, metal, glass, fabric, accent, dark, roof) and a material path. */
struct FBWSlotMat
{
	const TCHAR* Slot;
	const TCHAR* Path;
};

class FBWKitSet
{
public:
	explicit FBWKitSet(USceneComponent* InParent) : Parent(InParent) {}
	/** One instance of a kit mesh, with any slots recoloured (one component per mesh and colouring). */
	void Add(const TCHAR* Mesh, const FTransform& T, TArrayView<const FBWSlotMat> Mats = {});
	/** Lettering: a line of text facing Facing (its readable side), centred at At, Height cm tall, at most Width wide. Lit when bGlow. */
	void Text(const FString& Str, const FVector& At, const FVector2D& Facing, double Height, double Width, const FColor& Col, bool bGlow = true);
	/** Clear every instance and lettering (a full rebuild). */
	void Reset();

	/** When set, every instance laid is noted here (component, instance), and every lettering component in Extra. */
	TArray<TPair<UInstancedStaticMeshComponent*, int32>>* Record = nullptr;
	TArray<TWeakObjectPtr<USceneComponent>>* Extra = nullptr;
	int32 Instances() const { return Placed; }
	int32 Components() const { return Comps.Num(); }

private:
	USceneComponent* Parent;
	TMap<FString, UInstancedStaticMeshComponent*> Comps;
	TArray<TWeakObjectPtr<UTextRenderComponent>> Texts;
	int32 Placed = 0;
};

class FBWRetailBuilder
{
public:
	explicit FBWRetailBuilder(USceneComponent* InParent) : Kit(InParent) {}

	/** The builder's solid materials (FBWSolid::Mat indexes these). */
	static int32 NumMats();
	static const TCHAR* MatPath(int32 Mat);

	/** The body: the store's mass and its raised parapets, into Solids (every time its tile is meshed). */
	void Mass(const FBWVolume& V, TArray<FBWSolid>& Solids) const;
	/** The dressing: storefronts, piers, awnings, signs, towers, docks, roof plant, the pads' canopies (once per laying). Name: the centre's name for its pylon. */
	void Dress(const FBWVolume& V, const FString& Name);
	void Reset() { Kit.Reset(); KeepOut.Reset(); }

	FBWKitSet Kit;
	/** Ground the car parks must leave clear (pump and teller canopies, drive-through lanes, price signs), as rings. */
	TArray<TArray<FVector2D>> KeepOut;
};
