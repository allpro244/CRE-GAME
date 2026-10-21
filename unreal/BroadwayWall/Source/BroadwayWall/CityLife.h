// Phase 3: the street's life — traffic that keeps its lane, stops at signals and
// for the car ahead and turns at junctions; pedestrians on the sidewalks.
//
// Roads: the generator's street centrelines joined into a graph at shared ends.
// Each street carries one lane each way, offset to the right of travel. A node
// where three or more streets meet is a signalled intersection: the two axes
// (roughly north-south and east-west by arrival heading) alternate green with an
// all-red clearance. Cars follow the car ahead at a time gap, stop at the line on
// red, and pick an onward street at the end of a lane (no U-turn unless the
// street is a dead end).
//
// People: City Sample's vertex-animated crowd (AnimToTexture). Each person is a
// body plus a top, bottom, shoes, face and hair, every piece an instance in a
// shared instanced mesh carrying the same per-instance animation data
// (custom data 0 start frame, 1 frame count, 2 play rate, 3 looping, 4 time
// offset — ML_BoneAnimation). They walk the sidewalk rings at a stroll.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "CityLife.generated.h"

class UInstancedStaticMeshComponent;
struct FBWCity;

UCLASS()
class ACityLife : public AActor
{
	GENERATED_BODY()
public:
	ACityLife();
	virtual void Tick(float Dt) override;
	void Build(const FBWCity& City, int32 Seed);
	/**
	 * THE STREET'S LIFE AS A SETTING (Settings > Graphics > City life): 0 off,
	 * 1 light (walkers and moving cars drawn only near the camera), 2 full.
	 * Draw distances only: the simulation underneath runs the same.
	 */
	void SetDensity(int32 Level);
	/** The level last chosen, applied to a city built after the setting arrived. */
	static int32 DensityLevel;
	/** Where the person nearest P is now, and which way they face (for camera shots). */
	bool PersonNear(const FVector& P, FVector& Out, FVector2D& Facing) const;

private:
	// ---- roads
	struct FNode { FVector2D P; TArray<int32> Out; bool bSignal = false; };
	struct FLane { int32 From = 0, To = 0, Twin = -1; TArray<FVector2D> Pts; TArray<double> Cum; double Len = 0; int32 Axis = 0; TArray<int32> Cars; };
	struct FCar { int32 Lane = 0, Mesh = 0, Inst = 0; double S = 0, V = 0, V0 = 0; };
	TArray<FNode> Nodes;
	TArray<FLane> Lanes;
	TArray<FCar> Cars;
	UPROPERTY() TArray<TObjectPtr<UInstancedStaticMeshComponent>> CarMeshes;
	UPROPERTY() TArray<TObjectPtr<UInstancedStaticMeshComponent>> ParkedMeshes;
	double Clock = 0;
	uint32 Frame = 0;
	/** Whether this instance's new place goes to the renderer this frame: every frame near the camera, a slice of the rest each frame (so each far one a few times a second). */
	bool Due(const FVector2D& P, uint32 Index) const;
	FVector2D Eye = FVector2D::ZeroVector;
	bool Green(int32 Node, int32 Axis) const;
	FVector2D At(const FLane& L, double S, FVector2D* Dir) const;

	// ---- people
	struct FWalk { TArray<FVector2D> Pts; TArray<double> Cum; double Len = 0; };
	struct FPerson { int32 Walk = 0; double S = 0, V = 0; int32 Dir = 1; TArray<TPair<int32, int32>> Pieces; /* (mesh, instance) */ };
	TArray<FWalk> Walks;
	TArray<FPerson> People;
	UPROPERTY() TArray<TObjectPtr<UInstancedStaticMeshComponent>> PersonMeshes;
	TMap<FString, int32> PersonMeshIndex;
	int32 PieceMesh(const FString& Path);
};
