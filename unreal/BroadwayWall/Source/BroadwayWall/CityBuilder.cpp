#include "CityBuilder.h"

#include "CompGeom/PolygonTriangulation.h"
#include "IndexTypes.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "ProceduralMeshComponent.h"

DEFINE_LOG_CATEGORY_STATIC(LogBWBuilder, Log, All);

namespace
{
	/** Use colours, from the web build's economy page palette, lifted for daylight. */
	FLinearColor UseColor(const FBWVolume& V)
	{
		auto Hex = [](uint32 C) { return FLinearColor(FColor((C >> 16) & 255, (C >> 8) & 255, C & 255)); };
		if (V.bVacant) return Hex(0x8C8466);              // dirt
		if (V.bFrame) return Hex(0xA9A49A);               // concrete frame going up
		if (!V.Deco.IsEmpty()) return Hex(0x9A9A96);      // sheds, masts, civic dressing
		FLinearColor C = V.Cls == TEXT("office") ? Hex(0x5B8BC0)
			: V.Cls == TEXT("retail") ? Hex(0xC4744A)
			: V.Cls == TEXT("multifamily") ? Hex(0x6E9E79)
			: V.Cls == TEXT("industrial") ? Hex(0x9A8A62)
			: Hex(0xB0B0AA);
		return V.bCrown ? C * 0.8f : C;
	}

	FLinearColor GroundColor(const FString& Layer)
	{
		auto Hex = [](uint32 C) { return FLinearColor(FColor((C >> 16) & 255, (C >> 8) & 255, C & 255)); };
		if (Layer == TEXT("land")) return Hex(0xB8B3A3);
		if (Layer == TEXT("beach")) return Hex(0xD9C99A);
		if (Layer == TEXT("marsh")) return Hex(0x7E8C5A);
		if (Layer == TEXT("rock")) return Hex(0x7D7A72);
		if (Layer == TEXT("park")) return Hex(0x6E9A52);
		if (Layer == TEXT("pond") || Layer == TEXT("stream")) return Hex(0x3F6E8C);
		if (Layer == TEXT("sidewalk") || Layer == TEXT("esplanade")) return Hex(0xC9C5BB);
		if (Layer == TEXT("median")) return Hex(0x8FA070);
		return Hex(0x5A5C60); // pavement, paveland, apron: asphalt
	}

	/** Vertex/triangle accumulator for one procedural mesh section. */
	struct FMeshBuf
	{
		TArray<FVector> V;
		TArray<int32> T;
		TArray<FVector> N;
		TArray<FVector2D> UV;
		TArray<FLinearColor> C;

		int32 NumTris() const { return T.Num() / 3; }

		/** Flat polygon at height Z, facing up. Returns triangles added. */
		int32 AddCap(const TArray<FVector2D>& Ring, double Z, const FLinearColor& Col)
		{
			if (Ring.Num() < 3) return 0;
			TArray<UE::Geometry::FIndex3i> Tris;
			PolygonTriangulation::TriangulateSimplePolygon<double>(Ring, Tris, false);
			const int32 Base = V.Num();
			for (const FVector2D& P : Ring)
			{
				V.Emplace(P.X, P.Y, Z);
				N.Emplace(0, 0, 1);
				UV.Emplace(P.X / 1000.0, P.Y / 1000.0);
				C.Add(Col);
			}
			for (const UE::Geometry::FIndex3i& Tri : Tris) AddTri(Base + Tri.A, Base + Tri.B, Base + Tri.C, FVector::UpVector);
			return Tris.Num();
		}

		/** Vertical walls from Z0 to Z1 around Ring, facing out. Returns triangles added. */
		int32 AddWalls(const TArray<FVector2D>& Ring, double Z0, double Z1, const FLinearColor& Col)
		{
			const int32 Count = Ring.Num();
			if (Count < 3 || Z1 <= Z0) return 0;
			const double Area2 = SignedArea2(Ring);
			int32 Added = 0;
			for (int32 i = 0; i < Count; ++i)
			{
				const FVector2D A = Ring[i], B = Ring[(i + 1) % Count];
				const FVector2D E = B - A;
				if (E.SizeSquared() < 1.0) continue;
				// outward normal: right of the edge for a counter-clockwise ring (in X/Y)
				FVector2D Out2 = Area2 > 0 ? FVector2D(E.Y, -E.X) : FVector2D(-E.Y, E.X);
				Out2.Normalize();
				const FVector Out(Out2.X, Out2.Y, 0);
				const int32 Base = V.Num();
				const double Len = E.Size() / 1000.0;
				const FVector Q[4] = { FVector(A.X, A.Y, Z0), FVector(B.X, B.Y, Z0), FVector(B.X, B.Y, Z1), FVector(A.X, A.Y, Z1) };
				const FVector2D QUV[4] = { {0, Z0 / 1000.0}, {Len, Z0 / 1000.0}, {Len, Z1 / 1000.0}, {0, Z1 / 1000.0} };
				// walls a touch darker low down, so mass reads in flat light
				for (int32 k = 0; k < 4; ++k) { V.Add(Q[k]); N.Add(Out); UV.Add(QUV[k]); C.Add(Col * (k < 2 ? 0.85f : 1.0f)); }
				AddTri(Base, Base + 1, Base + 2, Out);
				AddTri(Base, Base + 2, Base + 3, Out);
				Added += 2;
			}
			return Added;
		}

		static double SignedArea2(const TArray<FVector2D>& R)
		{
			double S = 0;
			for (int32 i = 0, n = R.Num(); i < n; ++i) S += R[i].X * R[(i + 1) % n].Y - R[(i + 1) % n].X * R[i].Y;
			return S;
		}

		/** Add a triangle wound so its face points along Want (Unreal culls by winding). */
		void AddTri(int32 A, int32 B, int32 Cc, const FVector& Want)
		{
			const FVector Face = FVector::CrossProduct(V[Cc] - V[A], V[B] - V[A]);
			if (FVector::DotProduct(Face, Want) >= 0) T.Append({ A, B, Cc });
			else T.Append({ A, Cc, B });
		}

		void Emit(UProceduralMeshComponent* Mesh, int32 Section, bool bCollision) const
		{
			Mesh->CreateMeshSection_LinearColor(Section, V, T, N, UV, C, TArray<FProcMeshTangent>(), bCollision);
		}
	};
}

ACityBuilder::ACityBuilder()
{
	RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	static ConstructorHelpers::FObjectFinder<UMaterialInterface> VC(TEXT("/Engine/EngineDebugMaterials/VertexColorMaterial.VertexColorMaterial"));
	VertexColorMaterial = VC.Object;
}

bool ACityBuilder::BuildFromFile(const FString& Path)
{
	const double T0 = FPlatformTime::Seconds();
	if (!City.Load(Path)) return false;
	const double T1 = FPlatformTime::Seconds();
	BuildGround();
	Current = City.Volumes;
	BuildVolumes();
	BuildTrees();
	UE_LOG(LogBWBuilder, Display, TEXT("built %s: parse %.2fs, meshes %.2fs, %d building chunks"),
		*City.Name, T1 - T0, FPlatformTime::Seconds() - T1, Chunks.Num());
	return true;
}

void ACityBuilder::BuildGround()
{
	UProceduralMeshComponent* Ground = NewObject<UProceduralMeshComponent>(this, TEXT("Ground"));
	Ground->SetupAttachment(RootComponent);
	Ground->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Ground->SetCastShadow(false);
	Ground->RegisterComponent();

	// the sea: one big sheet well past the island
	FMeshBuf Sea;
	const FBox2D B = City.Bounds.ExpandBy(FMath::Max(City.Bounds.GetSize().X, City.Bounds.GetSize().Y) * 3.0);
	Sea.AddCap({ B.Min, FVector2D(B.Max.X, B.Min.Y), B.Max, FVector2D(B.Min.X, B.Max.Y) }, -120, FLinearColor(FColor(0x2E, 0x5A, 0x78)));
	for (const TArray<FVector2D>& R : City.Water) Sea.AddCap(R, -80, FLinearColor(FColor(0x4A, 0x7C, 0x96)));
	Sea.Emit(Ground, 0, false);

	// land and its dressing, each layer 2 cm above the last so nothing fights
	int32 Section = 1;
	double Z = 0;
	for (const TPair<FString, TArray<TArray<FVector2D>>>& L : City.Ground)
	{
		FMeshBuf M;
		const FLinearColor Col = GroundColor(L.Key);
		for (const TArray<FVector2D>& R : L.Value) M.AddCap(R, Z, Col);
		if (M.V.Num()) M.Emit(Ground, Section++, false);
		Z += 2;
	}
	for (int32 i = 0; i < Section; ++i) Ground->SetMaterial(i, VertexColorMaterial);
}

void ACityBuilder::BuildVolumes()
{
	for (UProceduralMeshComponent* Old : Chunks) if (Old) Old->DestroyComponent();
	Chunks.Reset();
	constexpr int32 PerChunk = 200;
	for (int32 Start = 0; Start < Current.Num(); Start += PerChunk)
	{
		FMeshBuf M;
		for (int32 i = Start; i < FMath::Min(Start + PerChunk, Current.Num()); ++i)
		{
			const FBWVolume& Vol = Current[i];
			const FLinearColor Col = UseColor(Vol);
			// vacant lots: a 30 cm pad, so they read and can be clicked
			const double Z0 = Vol.bVacant ? 0 : Vol.Z0;
			const double Z1 = Vol.bVacant ? 30 : FMath::Max(Vol.Z1, Vol.Z0 + 1);
			M.AddWalls(Vol.Ring, Z0, Z1, Col);
			M.AddCap(Vol.Ring, Z1, Vol.bPlayer ? FLinearColor(FColor(0xE8, 0xB8, 0x3A)) : Col * 1.08f);
		}
		UProceduralMeshComponent* Mesh = NewObject<UProceduralMeshComponent>(this, MakeUniqueObjectName(this, UProceduralMeshComponent::StaticClass(), TEXT("Buildings")));
		Mesh->SetupAttachment(RootComponent);
		Mesh->bUseAsyncCooking = true;
		Mesh->bUseComplexAsSimpleCollision = true;
		Mesh->SetCollisionProfileName(TEXT("BlockAll"));
		Mesh->RegisterComponent();
		M.Emit(Mesh, 0, true);
		Mesh->SetMaterial(0, VertexColorMaterial);
		Chunks.Add(Mesh);
	}
}

void ACityBuilder::BuildTrees()
{
	UStaticMesh* Sphere = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Sphere.Sphere"));
	UMaterialInterface* Base = LoadObject<UMaterialInterface>(nullptr, TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial"));
	if (!Sphere) return;
	Trees = NewObject<UInstancedStaticMeshComponent>(this, TEXT("Trees"));
	Trees->SetupAttachment(RootComponent);
	Trees->SetStaticMesh(Sphere);
	Trees->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	if (Base)
	{
		UMaterialInstanceDynamic* Leaf = UMaterialInstanceDynamic::Create(Base, this);
		Leaf->SetVectorParameterValue(TEXT("Color"), FLinearColor(FColor(0x4C, 0x7A, 0x3A)));
		Trees->SetMaterial(0, Leaf);
	}
	Trees->RegisterComponent();
	FRandomStream Rng(int32(City.Seed));
	for (const FVector2D& P : City.Trees)
	{
		const double D = Rng.FRandRange(6.0, 9.0); // crown diameter in m; the engine sphere is 1 m across
		Trees->AddInstance(FTransform(FRotator::ZeroRotator, FVector(P.X, P.Y, 250 + D * 45), FVector(D, D, D * 0.9)));
	}
}

const FBWParcel* ACityBuilder::ParcelFromHit(const FHitResult& Hit) const
{
	if (Chunks.IndexOfByKey(Cast<UProceduralMeshComponent>(Hit.GetComponent())) == INDEX_NONE) return nullptr;
	// by geometry, not by face index: collision cooking may reorder triangles.
	// A wall hit sits on the footprint edge, so step half a metre inside.
	const FVector P = Hit.ImpactPoint - Hit.ImpactNormal * 50.0;
	return ParcelAt(FVector2D(P.X, P.Y));
}

const FBWParcel* ACityBuilder::ParcelAt(const FVector2D& P) const
{
	auto Inside = [&P](const TArray<FVector2D>& R)
	{
		bool In = false;
		for (int32 i = 0, j = R.Num() - 1; i < R.Num(); j = i++)
			if (((R[i].Y > P.Y) != (R[j].Y > P.Y)) && (P.X < (R[j].X - R[i].X) * (P.Y - R[i].Y) / (R[j].Y - R[i].Y) + R[i].X)) In = !In;
		return In;
	};
	// volumes first (a tower can overhang its lot line), then parcels
	for (const FBWVolume& V : Current) if (!V.Bbl.IsEmpty() && Inside(V.Ring)) return City.FindParcel(V.Bbl);
	for (const FBWParcel& Pa : City.Parcels) if (Inside(Pa.Ring)) return &Pa;
	return nullptr;
}

double ACityBuilder::ParcelTop(const FString& Bbl) const
{
	double Top = 0;
	for (const FBWVolume& V : Current) if (V.Bbl == Bbl) Top = FMath::Max(Top, V.Z1);
	return Top;
}

namespace
{
	/** Andrew's monotone chain: the outline an assembled site builds inside (until sites carry a dissolved ring). */
	TArray<FVector2D> Hull(TArray<FVector2D> P)
	{
		P.Sort([](const FVector2D& A, const FVector2D& B) { return A.X < B.X || (A.X == B.X && A.Y < B.Y); });
		if (P.Num() < 3) return P;
		auto Cross = [](const FVector2D& O, const FVector2D& A, const FVector2D& B) { return (A.X - O.X) * (B.Y - O.Y) - (A.Y - O.Y) * (B.X - O.X); };
		TArray<FVector2D> H;
		for (int32 Pass = 0; Pass < 2; ++Pass)
		{
			const int32 Start = H.Num();
			for (int32 k = 0; k < P.Num(); ++k)
			{
				const FVector2D& Q = P[Pass == 0 ? k : P.Num() - 1 - k];
				while (H.Num() >= Start + 2 && Cross(H[H.Num() - 2], H.Last(), Q) <= 0) H.Pop();
				H.Add(Q);
			}
			H.Pop();
		}
		return H;
	}
}

void ACityBuilder::ApplyView(const FBWRenderView& View)
{
	// which deeds the economy has taken over, and the site each building sits on
	TMap<FString, TArray<FString>> SiteDeeds;
	for (const TPair<FString, FString>& M : View.Merged) SiteDeeds.FindOrAdd(M.Value).Add(M.Key);
	TSet<FString> Over;
	for (const FBWRenderLot& L : View.Lots) Over.Add(L.Bbl);
	for (const TPair<FString, FString>& M : View.Merged) Over.Add(M.Key);
	TSet<FString> Player;
	for (const FBWRenderOwner& O : View.Owners) if (O.Owner == TEXT("player")) Player.Add(O.Bbl);

	Current.Reset();
	for (const FBWVolume& V : City.Volumes)
		if (V.Bbl.IsEmpty() || !Over.Contains(V.Bbl))
		{
			FBWVolume& K = Current.Add_GetRef(V);
			K.bPlayer = Player.Contains(V.Bbl) && !V.bCrown;
		}

	int32 Frames = 0, Built = 0, Cleared = 0;
	for (const FBWRenderLot& L : View.Lots)
	{
		const FBWParcel* P = City.FindParcel(L.Bbl);
		if (!P || P->Ring.Num() < 3) continue;
		TArray<FVector2D> Ring = P->Ring;
		if (const TArray<FString>* Kids = SiteDeeds.Find(L.Bbl))
		{
			for (const FString& K : *Kids) if (const FBWParcel* C = City.FindParcel(K)) Ring.Append(C->Ring);
			Ring = Hull(Ring);
		}
		FBWVolume V;
		V.Bbl = L.Bbl;
		V.Cls = L.Cls;
		V.Year = L.Year;
		V.bPlayer = Player.Contains(L.Bbl);
		if (L.Cls == TEXT("land"))
		{
			V.bVacant = true;
			V.Ring = MoveTemp(Ring);
			Current.Add(MoveTemp(V));
			++Cleared;
			continue;
		}
		// the web renderer's footprint rule (map/real/RealCity.ts buildItem): the lot
		// scaled about its centre by sqrt(coverage), or 0.82 when none was kept
		FVector2D C(0, 0);
		for (const FVector2D& Q : Ring) C += Q;
		C /= Ring.Num();
		const double B = L.Cov > 0 ? FMath::Min(0.97, FMath::Sqrt(L.Cov)) : 0.82;
		for (FVector2D& Q : Ring) Q = C + (Q - C) * B;
		V.Ring = MoveTemp(Ring);
		V.Z0 = 0;
		V.Z1 = FMath::Max(3.0, L.HeightM) * 100.0;
		V.bFrame = L.bConstruction;
		Current.Add(MoveTemp(V));
		++(L.bConstruction ? Frames : Built);
	}
	BuildVolumes();
	UE_LOG(LogBWBuilder, Display, TEXT("month %d (%d): %d frames rising, %d built, %d cleared, %d owned by the player"),
		View.Month, View.Year, Frames, Built, Cleared, Player.Num());
}
