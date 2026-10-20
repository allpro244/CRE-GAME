#include "CityBuilder.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonSerializer.h"
#include "Misc/FileHelper.h"
#include "CityLife.h"

#include "CompGeom/PolygonTriangulation.h"
#include "ConstrainedDelaunay2.h"
#include "Polygon2.h"
#include "IndexTypes.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "ProceduralMeshComponent.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "Misc/Paths.h"
#include "Misc/PackageName.h"
#include "Misc/FileHelper.h"

DEFINE_LOG_CATEGORY_STATIC(LogBWBuilder, Log, All);

namespace
{
	/** The road surface, one dynamic instance for every street so the weather can wet it. */
	UMaterialInstanceDynamic* Road = nullptr;
	float RoadDry[3] = { 0, 0, 0 };
	const TCHAR* const RoadWet[3] = { TEXT("Puddle Height MFPD"), TEXT("Wetness Road Edge Amt MFPD"), TEXT("Wetness Tire Lane Amt MFPD") };
	UMaterialInterface* BWRoadMaterial()
	{
		if (!Road)
			// the matte parking-lot instance of the street master: the street instance is
			// authored glossy, and reads as standing water from the air
			if (UMaterialInterface* Base = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/Road/Material/MI/M_Asphalt_Master_Inst_ParkingLots.M_Asphalt_Master_Inst_ParkingLots")))
			{
				Road = UMaterialInstanceDynamic::Create(Base, GetTransientPackage());
				Road->AddToRoot();
				// the lot instance is a sun-bleached grey; a city street is darker
				Road->SetVectorParameterValue(TEXT("BaseColor Tint"), FLinearColor(0.45f, 0.45f, 0.47f));
				for (int32 i = 0; i < 3; ++i) Base->GetScalarParameterValue(FHashedMaterialParameterInfo(RoadWet[i]), RoadDry[i]);
			}
		return Road;
	}
	/** The parks' lawn (tools/make-grass.py), one dynamic instance so the season can colour it. */
	UMaterialInstanceDynamic* Grass = nullptr;
	UMaterialInterface* BWGrassMaterial()
	{
		if (!Grass)
			if (UMaterialInterface* Base = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/BW/Materials/M_BW_Grass.M_BW_Grass")))
			{
				Grass = UMaterialInstanceDynamic::Create(Base, GetTransientPackage());
				Grass->AddToRoot();
				// a city lawn, worn and a little dusty, not a golf green
				Grass->SetVectorParameterValue(TEXT("GrassDark"), FLinearColor(0.028f, 0.040f, 0.017f));
				Grass->SetVectorParameterValue(TEXT("GrassLight"), FLinearColor(0.062f, 0.076f, 0.034f));
			}
		return Grass;
	}
}

void ACityBuilder::SetSeasonGrass(int32 MonthOfYear)
{
	// A cool-season lawn in a mid-Atlantic city: straw-dull through the winter,
	// greening in April, at its deepest in June, tired and olive by August's
	// heat, a second green in September, browning from November. Multipliers on
	// the lawn's own greens (M_BW_Grass "Season").
	static const FLinearColor ByMonth[12] = {
		{ 1.95f, 1.15f, 1.55f }, { 1.95f, 1.15f, 1.55f }, { 1.6f, 1.15f, 1.3f },   // Jan Feb Mar: dormant
		{ 1.15f, 1.2f, 1.0f },   { 1.0f, 1.12f, 0.95f },  { 1.0f, 1.0f, 1.0f },    // Apr May Jun
		{ 1.12f, 1.0f, 0.9f },   { 1.3f, 1.05f, 0.9f },   { 1.05f, 1.02f, 0.95f }, // Jul Aug Sep
		{ 1.2f, 1.05f, 0.95f },  { 1.55f, 1.12f, 1.25f }, { 1.85f, 1.15f, 1.5f } };// Oct Nov Dec
	if (BWGrassMaterial()) Grass->SetVectorParameterValue(TEXT("Season"), ByMonth[((MonthOfYear % 12) + 12) % 12]);
}

void ACityBuilder::SetWetness(float Wet)
{
	// City Sample's asphalt carries its own puddles and wet tyre tracks at the
	// authored amount (a street the morning after rain). Dry weather takes them
	// down to a trace; rain takes them up past it.
	// (The master also masks puddles by vertex colour, and every street mesh here
	// carries one flat colour, so with puddles on the whole carriageway floods:
	// they are switched off outright unless it has rained.)
	if (!BWRoadMaterial()) return;
	const float W = FMath::Clamp(Wet, 0.f, 1.f);
	Road->SetScalarParameterValue(TEXT("Enable Puddle MFPD"), W > 0.3f ? 1.f : 0.f);
	const float K = FMath::Lerp(0.f, 1.2f, W);
	for (int32 i = 0; i < 3; ++i) Road->SetScalarParameterValue(RoadWet[i], RoadDry[i] * K);
	// and the surface itself: City Sample authored its streets glossy, the look of
	// asphalt after rain, which at a low sun angle mirrors the sky like standing
	// water. Dry asphalt is rough (~0.9); wet goes back to the authored sheen.
	Road->SetScalarParameterValue(TEXT("Roughness 3O"), FMath::Lerp(0.85f, 0.22f, W));
	Road->SetScalarParameterValue(TEXT("BaseRoughnessMult"), FMath::Lerp(1.6f, 0.58f, W));
	Road->SetScalarParameterValue(TEXT("Base_Roughness"), FMath::Lerp(0.9f, 0.5f, W));
	Road->SetScalarParameterValue(TEXT("Rough Mult 4G"), FMath::Lerp(1.3f, 0.8f, W));
	Road->SetScalarParameterValue(TEXT("Roughness MFPD"), FMath::Lerp(0.9f, 0.05f, W));
}

namespace
{
	/** City Sample surface for a ground layer (migrated by unreal/tools/asset-closure.py "ground"), or null for a flat colour. */
	UMaterialInterface* GroundMaterial(const FString& Layer)
	{
		const TCHAR* Path = nullptr;
		if (Layer == TEXT("pavement")) return BWRoadMaterial();
		// the base paving under everything and the aprons (boulevard carriageways,
		// quays): the street master authored glossy reads as standing water across
		// a big unmarked expanse at a low angle; the parking-lot instance is matte
		if (Layer == TEXT("apron")) Path = TEXT("/Game/Road/Material/MI/M_Asphalt_Master_Inst_ParkingLots.M_Asphalt_Master_Inst_ParkingLots");
		// the base under the whole plat shows only where nothing else is drawn:
		// open paved ground (the web map paints it light), not road
		if (Layer == TEXT("paveland")) Path = TEXT("/Game/Road/Material/MI/MI_Sidewalk_Plaza_B_WS.MI_Sidewalk_Plaza_B_WS");
		else if (Layer == TEXT("sidewalk") || Layer == TEXT("land"))
		{
			// CONCRETE, NOT TERRACOTTA. The world-space sidewalk is City Sample's
			// Inst_4, which tints its slabs brick-red (BaseColor_Tint 0.59/0.44/0.43);
			// Inst_6 is the same slab in plain concrete (0.59/0.58/0.58). Keep the
			// world-space mapping, take Inst_6's tint.
			static UMaterialInstanceDynamic* Grey = nullptr;
			if (!Grey)
				if (UMaterialInterface* Base = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/Road/Material/MI/M_Sidewalk_Master_Inst_4_WS.M_Sidewalk_Master_Inst_4_WS")))
				{
					Grey = UMaterialInstanceDynamic::Create(Base, GetTransientPackage());
					Grey->SetVectorParameterValue(TEXT("BaseColor_Tint"), FLinearColor(0.59375f, 0.579379f, 0.578288f, 1));
					Grey->AddToRoot();
				}
			return Grey;
		}
		// the inside of a block, where the buildings stop: service yards, alleys and
		// the back-lot parking a downtown block is mostly made of behind its fronts
		else if (Layer == TEXT("block")) Path = TEXT("/Game/Road/Material/MI/M_Asphalt_Master_Inst_ParkingLots.M_Asphalt_Master_Inst_ParkingLots");
		else if (Layer == TEXT("esplanade")) Path = TEXT("/Game/Road/Material/MI/MI_Sidewalk_Plaza_A_WS.MI_Sidewalk_Plaza_A_WS");
		else if (Layer == TEXT("park") || Layer == TEXT("median")) return BWGrassMaterial();   // a boulevard's planted median is lawn too
		else if (Layer == TEXT("beach")) Path = TEXT("/Game/Megascans/Surfaces/sand_sand_pjuuP0/M_sand.M_sand");
		else if (Layer == TEXT("sea") || Layer == TEXT("pond") || Layer == TEXT("stream"))
		{
			// HARBOUR WATER IS NOT A LAGOON. City Sample's ocean reads tropical turquoise
			// from the air; a northern port's water is a deep grey-green, a little
			// desaturated, with foam only in the chop
			static UMaterialInstanceDynamic* Harbour = nullptr;
			if (!Harbour)
				if (UMaterialInterface* Base = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/Prop/kit_ocean/Material/M_ocean.M_ocean")))
				{
					Harbour = UMaterialInstanceDynamic::Create(Base, GetTransientPackage());
					Harbour->AddToRoot();
					float V = 1;
					if (Base->GetScalarParameterValue(FHashedMaterialParameterInfo(TEXT("Mult CR")), V)) Harbour->SetScalarParameterValue(TEXT("Mult CR"), V * 0.55f);
					if (Base->GetScalarParameterValue(FHashedMaterialParameterInfo(TEXT("Amt FM")), V)) Harbour->SetScalarParameterValue(TEXT("Amt FM"), V * 0.35f);
					Harbour->SetScalarParameterValue(TEXT("Desat CR"), 0.45f);
					Harbour->SetVectorParameterValue(TEXT("Tint CR"), FLinearColor(0.50f, 0.70f, 0.66f));
				}
			return Harbour;
		}
		return Path ? LoadObject<UMaterialInterface>(nullptr, Path) : nullptr;
	}

	/** Use colours, from the web build's economy page palette, lifted for daylight. */
	FLinearColor UseColor(const FBWVolume& V)
	{
		auto Hex = [](uint32 C) { return FLinearColor(FColor((C >> 16) & 255, (C >> 8) & 255, C & 255)); };
		if (V.bVacant) return Hex(0x8C8466);              // dirt
		if (V.bFrame) return Hex(0xA9A49A);               // concrete frame going up
		if (V.Deco == TEXT("hoarding")) return Hex(0x2F5D8C); // site hoarding, painted plywood
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
		if (Layer == TEXT("park")) return Hex(0x6B6F4E); // winter lawn under bare trees, as in the reference plates
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
		/** World cm per UV unit (texture tile size). */
		double UVScale = 1000.0;

		int32 NumTris() const { return T.Num() / 3; }

		/** Flat polygon at height Z, facing up. Returns triangles added. */
		int32 AddCap(const TArray<FVector2D>& Ring, double Z, const FLinearColor& Col)
		{
			if (Ring.Num() < 3) return 0;
			TArray<UE::Geometry::FIndex3i> Tris;
			PolygonTriangulation::TriangulateSimplePolygon<double>(Ring, Tris, false);
			// EAR CLIPPING DROPS PIECES OF A MESSY RING. The island's base layers are
			// single rings thousands of points long with near-touching necks, and the
			// ear clipper gave up partway, leaving holes the sea showed through (the
			// "flooded" boulevard carriageways). When the triangles cover visibly less
			// than the ring, triangulate again with constrained Delaunay, which keeps
			// every edge and fills what the ring encloses.
			double Want = 0, Got = 0;
			for (int32 i = 0; i < Ring.Num(); ++i) Want += Ring[i].X * Ring[(i + 1) % Ring.Num()].Y - Ring[(i + 1) % Ring.Num()].X * Ring[i].Y;
			for (const UE::Geometry::FIndex3i& Tr : Tris)
			{
				const FVector2D a = Ring[Tr.A], b = Ring[Tr.B], c = Ring[Tr.C];
				Got += FMath::Abs((b.X - a.X) * (c.Y - a.Y) - (c.X - a.X) * (b.Y - a.Y));
			}
			if (Got < FMath::Abs(Want) * 0.995)
			{
				UE::Geometry::FConstrainedDelaunay2d CDT;
				CDT.FillRule = UE::Geometry::FConstrainedDelaunay2d::EFillRule::NonZero;
				UE::Geometry::FPolygon2d Poly;
				for (const FVector2D& P : Ring) Poly.AppendVertex(UE::Math::TVector2<double>(P.X, P.Y));
				CDT.Add(Poly);
				if (CDT.Triangulate() && CDT.Triangles.Num())
				{
					// the CDT may merge duplicate points: use its own vertices
					const int32 Base = V.Num();
					for (const UE::Math::TVector2<double>& P : CDT.Vertices)
					{
						V.Emplace(P.X, P.Y, Z); N.Emplace(0, 0, 1); UV.Emplace(P.X / UVScale, P.Y / UVScale); C.Add(Col);
					}
					for (const UE::Geometry::FIndex3i& Tri : CDT.Triangles) AddTri(Base + Tri.A, Base + Tri.B, Base + Tri.C, FVector::UpVector);
					static int32 Logged = 0;
					if (Logged++ < 20) UE_LOG(LogTemp, Display, TEXT("cap: ear clipping covered %.1f%% of a %d-point ring; constrained Delaunay used"), 100.0 * Got / FMath::Max(1.0, FMath::Abs(Want)), Ring.Num());
					return CDT.Triangles.Num();
				}
			}
			const int32 Base = V.Num();
			for (const FVector2D& P : Ring)
			{
				V.Emplace(P.X, P.Y, Z);
				N.Emplace(0, 0, 1);
				UV.Emplace(P.X / UVScale, P.Y / UVScale);
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
	PrimaryActorTick.bCanEverTick = true;
	RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	static ConstructorHelpers::FObjectFinder<UMaterialInterface> VC(TEXT("/Engine/EngineDebugMaterials/VertexColorMaterial.VertexColorMaterial"));
	VertexColorMaterial = VC.Object;
}

bool ACityBuilder::BuildFromFile(const FString& Path)
{
	FString Text;
	if (!FFileHelper::LoadFileToString(Text, *Path)) { UE_LOG(LogBWBuilder, Error, TEXT("cannot read %s"), *Path); return false; }
	return BuildFromText(Text);
}

bool ACityBuilder::BuildFromText(const FString& Text)
{
	const double T0 = FPlatformTime::Seconds();
	if (!City.LoadText(Text, TEXT("bridge"))) return false;
	const double T1 = FPlatformTime::Seconds();
	// Phase 3 facades: on when the kit table and its migrated meshes are here (-NoFacades: blocks only)
	// every Data/kit-*.json whose meshes are migrated; -Kits=CHF,SFC narrows it
	if (!FParse::Param(FCommandLine::Get(), TEXT("NoFacades")))
	{
		FString Only;
		FParse::Value(FCommandLine::Get(), TEXT("Kits="), Only);
		TArray<FString> Files;
		IFileManager::Get().FindFiles(Files, *(FPaths::ProjectDir() / TEXT("Data/kit-*.json")), true, false);
		for (const FString& F : Files)
		{
			const FString Name = FPaths::GetBaseFilename(F).RightChop(4);
			if (!Only.IsEmpty() && !Only.Contains(Name)) continue;
			FBWKit K;
			if (K.Load(FPaths::ProjectDir() / TEXT("Data") / F) && K.Bands.ContainsByPredicate([](const FBWKitBand& B) { return B.Walls.Num() > 0; })) Kits.Add(MoveTemp(K));
		}
	}
	bFacades = Kits.Num() > 0;
	// the web map's facade families onto the kits (unreal/tools/facade-families.mjs)
	{
		FString Json;
		TSharedPtr<FJsonObject> Root;
		if (FFileHelper::LoadFileToString(Json, *(FPaths::ProjectDir() / TEXT("Data/facade-families.json"))) && FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Json), Root) && Root)
		{
			for (const TPair<FString, TSharedPtr<FJsonValue>>& P : Root->GetObjectField(TEXT("kits"))->Values)
			{
				TArray<FString>& L = FamilyKits.Add(P.Key);
				for (const TSharedPtr<FJsonValue>& K : P.Value->AsArray()) L.Add(K->AsString());
			}
			for (const TPair<FString, TSharedPtr<FJsonValue>>& P : Root->GetObjectField(TEXT("like"))->Values) FamilyLike.Add(P.Key, P.Value->AsString());
		}
		UE_LOG(LogTemp, Display, TEXT("facade families: %d mapped onto %d kits"), FamilyKits.Num(), Kits.Num());
	}
	if (bFacades) Facades = MakeUnique<FBWFacadeBuilder>(RootComponent);
	BuildGround();
	Current = City.Volumes;
	BuildVolumes();
	BuildTrees();
	BuildMarkings();
	// the street's life: signalled traffic and pedestrians (CityLife); -NoTraffic for neither
	if (!FParse::Param(FCommandLine::Get(), TEXT("NoTraffic")))
	{
		ACityLife* Life = GetWorld()->SpawnActor<ACityLife>();
		Life->Build(City, int32(City.Seed));
		Life->AttachToActor(this, FAttachmentTransformRules::KeepWorldTransform);
	}
	BuildStreetProps();
	UE_LOG(LogBWBuilder, Display, TEXT("built %s: parse %.2fs, meshes %.2fs, %d building chunks, %d facade pieces (%s)"),
		*City.Name, T1 - T0, FPlatformTime::Seconds() - T1, Chunks.Num(), Facades ? Facades->Pieces() : 0, bFacades ? *FString::JoinBy(Kits, TEXT(","), [](const FBWKit& K) { return K.Name; }) : TEXT("blocks only"));
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
	// THE FAR SHORE. A harbour town looks across its water at somewhere: a band of
	// low land 2.5-5 km off, over half the compass, built up with City Sample's
	// background-city blocks (low-detail masses meant to be seen through haze),
	// thinning and lowering toward the ends of the arc.
	{
		const FVector2D C = City.Bounds.GetCenter();
		const double R0 = 0.5 * FMath::Max(City.Bounds.GetSize().X, City.Bounds.GetSize().Y) + 250000;
		FRandomStream Rng(int32(City.Seed) ^ 0x5402e);
		const double A0 = Rng.FRandRange(0, 2 * PI), Span = PI * 1.1;
		const int32 Steps = 64;
		auto Pt = [&](double A, double R) { return C + FVector2D(FMath::Cos(A), FMath::Sin(A)) * R; };
		for (int32 k = 0; k < Steps; ++k)
		{
			const double a = A0 + Span * k / Steps, b = A0 + Span * (k + 1) / Steps;
			Sea.AddCap({ Pt(a, R0 - 20000), Pt(b, R0 - 20000), Pt(b, R0 + 400000), Pt(a, R0 + 400000) }, -60, FLinearColor(FColor(0x5C, 0x5E, 0x58)));
		}
		static const TCHAR* const Bg[] = {
			TEXT("/Game/Environment/Background_City/Mesh/SM_bgcitya.SM_bgcitya"),
			TEXT("/Game/Environment/Background_City/Mesh/SM_bgcityb.SM_bgcityb") };
		for (double a = A0 + 0.03; a < A0 + Span - 0.03; a += 30000.0 / R0)
		{
			const double t = (a - A0) / Span, Edge = FMath::Sin(t * PI);          // 0 at the arc's ends, 1 mid
			for (int32 row = 0; row < 3; ++row)
			{
				if (Rng.FRand() > 0.35 + 0.6 * Edge) continue;
				const double R = R0 + 15000 + row * 70000 + Rng.FRandRange(-15000, 15000);
				const double Sc = (14 + 20 * Edge * Rng.FRand()) * (1.0 - 0.18 * row);
				const int32 m = Rng.RandRange(0, 1);   // mesh bottoms sit 249 / 188 cm below their pivots
				AddProp(Bg[m], FTransform(FRotator(0, Rng.FRandRange(0, 360), 0), FVector(Pt(a, R), (m ? 188 : 249) * Sc - 60), FVector(Sc)), false);
			}
		}
	}
	Sea.Emit(Ground, 0, false);
	TArray<UMaterialInterface*> Mats = { GroundMaterial(TEXT("sea")) };

	// land and its dressing, each layer a centimetre above the last so nothing
	// fights. THE FOOTWAY IS A STEP UP: sidewalks, medians and lawns stand a
	// kerb's height (12 cm, a city kerb's 4-6 in) above the carriageway, and
	// every raised ring gets the kerb's vertical face in concrete down to the
	// road. A footway level with the asphalt read as paint on one sheet.
	int32 Section = 1;
	double Z = 0, RoadZ = 0;
	constexpr double KerbH = 12;
	FMeshBuf Kerbs;
	Kerbs.UVScale = 100.0;
	for (const TPair<FString, TArray<TArray<FVector2D>>>& L : City.Ground)
	{
		const bool bRaised = L.Key == TEXT("sidewalk") || L.Key == TEXT("block") || L.Key == TEXT("park") || L.Key == TEXT("median");
		if (L.Key == TEXT("pavement")) RoadZ = Z;
		const double Zl = bRaised ? Z + KerbH : Z;
		FMeshBuf M;
		// asphalt and paving tile at a few metres
		M.UVScale = 400.0;
		const FLinearColor Col = GroundColor(L.Key);
		for (const TArray<FVector2D>& R : L.Value)
		{
			M.AddCap(R, Zl, Col);
			if (bRaised && L.Key != TEXT("block")) Kerbs.AddWalls(R, RoadZ - 1, Zl, FLinearColor::White);
		}
		if (M.V.Num()) { M.Emit(Ground, Section++, false); Mats.Add(GroundMaterial(L.Key)); }
		Z += 1;
		if (bRaised) FootZ = FMath::Max(FootZ, Zl);
	}
	if (Kerbs.V.Num())
	{
		Kerbs.Emit(Ground, Section++, false);
		Mats.Add(LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/Road/Material/MI/M_roadcurb_master_concrete_instance.M_roadcurb_master_concrete_instance")));
	}
	Z = FootZ + 1;
	{
		TArray<TArray<FVector2D>> Paths;
		DressParks(Paths);
		FMeshBuf M;
		M.UVScale = 400.0;
		for (const TArray<FVector2D>& R : Paths) M.AddCap(R, Z, FLinearColor(FColor(0xB5, 0xAE, 0xA0)));
		if (M.V.Num()) { M.Emit(Ground, Section++, false); Mats.Add(GroundMaterial(TEXT("esplanade"))); }
	}
	for (int32 i = 0; i < Section; ++i) Ground->SetMaterial(i, Mats.IsValidIndex(i) && Mats[i] ? Mats[i] : VertexColorMaterial.Get());
}

void ACityBuilder::BuildVolumes()
{
	for (UProceduralMeshComponent* Old : Chunks) if (Old) Old->DestroyComponent();
	Chunks.Reset();
	if (Facades) Facades->Reset();
	ClearRoofProps();
	constexpr int32 PerChunk = 200;
	for (int32 Start = 0; Start < Current.Num(); Start += PerChunk)
	{
		constexpr int32 NumRoofs = 8;
		FMeshBuf M, Roofs[NumRoofs], Lots, Stone;
		Stone.UVScale = 300.0;
		Lots.UVScale = 400.0;
		for (FMeshBuf& R : Roofs) R.UVScale = 300.0;
		// a roof's covering: mostly the three tar-and-gravel finishes, then the
		// coated and membrane roofs, the odd copper or painted tin on an old one
		auto RoofOf = [](const FBWVolume& V)
		{
			const float U = float(GetTypeHash(V.Bbl) % 1000u) / 1000.f;
			if (V.Year > 0 && V.Year < 1930 && U < 0.05f) return 6;                // copper
			if (V.Year > 0 && V.Year < 1950 && U > 0.96f) return 7;                // red tin
			static const float Cum[6] = { 0.24f, 0.40f, 0.54f, 0.72f, 0.86f, 1.0f };
			for (int32 i = 0; i < 6; ++i) if (U < Cum[i]) return i;
			return 0;
		};
		for (int32 i = Start; i < FMath::Min(Start + PerChunk, Current.Num()); ++i)
		{
			const FBWVolume& Vol = Current[i];
			const bool bDress = bFacades && !Vol.bVacant && !Vol.bFrame && !Vol.bOpen && Vol.Deco.IsEmpty() && Vol.Z1 - Vol.Z0 >= 400;
			if (bDress)
			{
				// the facade carries the look; the mass sits 60 cm behind it (no flicker
				// against the kit's faces, and it still catches clicks), roofed in gravel
				const int32 Pieces = Facades->Dress(*KitFor(Vol), Vol, GetTypeHash(Vol.Bbl) ^ uint32(Vol.Z0), Vol.Z0 < 50, Vol.Look.bTint ? Vol.Look.Tint : Vol.Tint, Vol.Look.bTint);
				if (bPreview && Vol.Bbl == PreviewVol.Bbl) UE_LOG(LogBWBuilder, Display, TEXT("preview %s: kit %s, %d pieces, %.0f-%.0f cm"), *Vol.Bbl, *KitFor(Vol)->Name, Pieces, Vol.Z0, Vol.Z1);
				if (Pieces > 0)
				{
					if (Vol.bCrown || Vol.Z1 >= 0) DressRoof(Vol, GetTypeHash(Vol.Bbl));
					if (Vol.Z0 < 50 && (Vol.bFresh || Vol.Distress >= 2)) StreetMoment(Vol);
					M.AddWalls(BWInsetRing(Vol.Ring, 60), Vol.Z0, Vol.Z1, FLinearColor(FColor(0x55, 0x52, 0x4E)));
					if (Vol.bPlayer) M.AddCap(Vol.Ring, Vol.Z1 - 5, FLinearColor(FColor(0xE8, 0xB8, 0x3A)));
					else Roofs[RoofOf(Vol)].AddCap(Vol.Ring, Vol.Z1 - 5, FLinearColor::White);
					continue;
				}
			}
			if (Vol.bVacant && !Vol.bFrame && Vol.Ring.Num() >= 3)
			{
				// AN EMPTY LOT DOWNTOWN IS A CAR PARK until somebody builds on it
				Lots.AddCap(Vol.Ring, 8, FLinearColor::White);
				ParkLot(Vol, GetTypeHash(Vol.Bbl));
				continue;
			}
			// with the facades on, a piece too low to dress (a stair bulkhead, a
			// penthouse, a lift overrun) is a roof structure: brick-and-stucco grey, not
			// the economy map's use colour
			const FLinearColor Col = bFacades && !Vol.bVacant && !Vol.bFrame && Vol.Deco.IsEmpty() && !Vol.bPlayer
				? FLinearColor(FColor(0x8A, 0x84, 0x7C)) : UseColor(Vol);
			// vacant lots: a 30 cm pad, so they read and can be clicked
			const double Z0 = Vol.bVacant ? 0 : Vol.Z0;
			const double Z1 = Vol.bVacant ? 30 : FMath::Max(Vol.Z1, Vol.Z0 + 1);
			// a civic monument (plinth, column, statue base) is dressed stone
			FMeshBuf& Into = Vol.Deco.StartsWith(TEXT("civic")) ? Stone : M;
			Into.AddWalls(Vol.Ring, Z0, Z1, Col);
			if (!Vol.bOpen) Into.AddCap(Vol.Ring, Z1, Vol.bPlayer ? FLinearColor(FColor(0xE8, 0xB8, 0x3A)) : Col * 1.08f);
		}
		UProceduralMeshComponent* Mesh = NewObject<UProceduralMeshComponent>(this, MakeUniqueObjectName(this, UProceduralMeshComponent::StaticClass(), TEXT("Buildings")));
		Mesh->SetupAttachment(RootComponent);
		Mesh->bUseAsyncCooking = true;
		Mesh->bUseComplexAsSimpleCollision = true;
		Mesh->SetCollisionProfileName(TEXT("BlockAll"));
		Mesh->RegisterComponent();
		M.Emit(Mesh, 0, true);
		Mesh->SetMaterial(0, VertexColorMaterial);
		if (Stone.V.Num())
		{
			Stone.Emit(Mesh, 2, true);
			UMaterialInterface* StoneMat = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/Building/Material/MI/Paint/MI_Bldg_PaintedStone_Beige.MI_Bldg_PaintedStone_Beige"));
			Mesh->SetMaterial(2, StoneMat ? StoneMat : VertexColorMaterial.Get());
		}
		if (Lots.V.Num())
		{
			const int32 LotSec = 1;   // 0 walls, 1 lots, 2 stone, 3.. roofs
			Lots.Emit(Mesh, LotSec, true);
			UMaterialInterface* LotMat = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/Road/Material/MI/M_Asphalt_Master_Inst_ParkingLots.M_Asphalt_Master_Inst_ParkingLots"));
			Mesh->SetMaterial(LotSec, LotMat ? LotMat : VertexColorMaterial.Get());
		}
		// roofs: City Sample's rooftop surfaces (bitumen, dirty concrete tiles, pebble-dash), one per building
		// ...and the coverings a city's roofs actually wear besides: the silver
		// reflective coat, white membrane, black tar, green copper and red tin
		static const TCHAR* RoofPaths[NumRoofs] = {
			TEXT("/Game/Environment/RoofTop/Material/MI/MI_Rooftop_BitumenRoofing.MI_Rooftop_BitumenRoofing"),
			TEXT("/Game/Environment/RoofTop/Material/MI/MI_Rooftop_DirtyConcreteTiles.MI_Rooftop_DirtyConcreteTiles"),
			TEXT("/Game/Environment/RoofTop/Material/MI/MI_Rooftop_PebbleDash.MI_Rooftop_PebbleDash"),
			TEXT("/Game/Building/Material/MI/Paint/MI_Bldg_PaintedMetal_Roof.MI_Bldg_PaintedMetal_Roof"),
			TEXT("/Game/Building/Material/MI/Paint/MI_Bldg_PaintedStone_White.MI_Bldg_PaintedStone_White"),
			TEXT("/Game/Building/Material/MI/Paint/MI_Bldg_PaintedStone_Black.MI_Bldg_PaintedStone_Black"),
			TEXT("/Game/Building/Material/MI/Paint/MI_Bldg_PaintedMetal_Green.MI_Bldg_PaintedMetal_Green"),
			TEXT("/Game/Building/Material/MI/Paint/MI_Bldg_PaintedMetal_Red.MI_Bldg_PaintedMetal_Red") };
		int32 Sec = 3;
		for (int32 r = 0; r < NumRoofs; ++r)
		{
			if (!Roofs[r].V.Num()) continue;
			Roofs[r].Emit(Mesh, Sec, true);
			UMaterialInterface* Roof = LoadObject<UMaterialInterface>(nullptr, RoofPaths[r]);
			Mesh->SetMaterial(Sec++, Roof ? Roof : VertexColorMaterial.Get());
		}
		Chunks.Add(Mesh);
	}
}

void ACityBuilder::BuildTrees()
{
	if (UStaticMesh* Cube = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cube.Cube")))
	{
		Cranes = NewObject<UInstancedStaticMeshComponent>(this, TEXT("Cranes"));
		Cranes->SetupAttachment(RootComponent);
		Cranes->SetStaticMesh(Cube);
		Cranes->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		if (UMaterialInterface* Base = LoadObject<UMaterialInterface>(nullptr, TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial")))
		{
			UMaterialInstanceDynamic* Yellow = UMaterialInstanceDynamic::Create(Base, this);
			Yellow->SetVectorParameterValue(TEXT("Color"), FLinearColor(FColor(0xF2, 0xB7, 0x05)));
			Cranes->SetMaterial(0, Yellow);
		}
		Cranes->RegisterComponent();
	}
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
		Leaf->SetVectorParameterValue(TEXT("Color"), FLinearColor(FColor(0x2C, 0x3E, 0x22))); // placeholder: dark, so it does not bounce green over the street
		Trees->SetMaterial(0, Leaf);
	}
	Trees->RegisterComponent();
	FRandomStream Rng(int32(City.Seed));
	if (FPackageName::DoesPackageExist(TEXT("/Game/Prop/Kit_Tree_Alder/Mesh/Tree_Alder_A"))) return; // real trees: BuildStreetProps
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
	TMap<FString, int32> Distress;
	Owners.Reset();
	for (const FBWRenderOwner& O : View.Owners)
	{
		if (O.Owner == TEXT("player")) Player.Add(O.Bbl);
		if (O.Distress) Distress.Add(O.Bbl, O.Distress);
		Owners.Add(O.Bbl, O.Owner == TEXT("player") ? TEXT("player") : O.Firm);
	}

	Current.Reset();
	for (const FBWVolume& V : City.Volumes)
		if (V.Bbl.IsEmpty() || !Over.Contains(V.Bbl))
		{
			FBWVolume& K = Current.Add_GetRef(V);
			K.bPlayer = Player.Contains(V.Bbl) && !V.bCrown;
			K.Distress = Distress.FindRef(V.Bbl);
		}

	int32 Frames = 0, Built = 0, Cleared = 0;
	if (Cranes) Cranes->ClearInstances();
	Sites.Reset();
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
		V.bFresh = L.bFresh;
		V.Facade = L.Facade;
		V.Look = L.Look;
		V.Distress = Distress.FindRef(L.Bbl);
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
		if (L.bConstruction)
		{
			// the site: a hoarding round the whole lot, and a crane over the frame
			// topping out a few storeys above where the finished roof will be
			FBWVolume Fence;
			Fence.Bbl = L.Bbl;
			Fence.Deco = TEXT("hoarding");
			Fence.bOpen = true;
			Fence.Z1 = 240;
			Fence.Ring = P->Ring;
			Current.Add(MoveTemp(Fence));
			const double Top = FMath::Max(L.Floors * 355.0, V.Z1) + 1200.0;
			AddCrane(V.Ring, Top, GetTypeHash(L.Bbl));
			Sites.Add(FVector(C, Top));
		}
		Current.Add(MoveTemp(V));
		++(L.bConstruction ? Frames : Built);
	}
	BaseVolumes = Current;
	if (bPreview) ComposePreview();
	BuildVolumes();
	UE_LOG(LogBWBuilder, Display, TEXT("month %d (%d): %d frames rising, %d built, %d cleared, %d owned by the player"),
		View.Month, View.Year, Frames, Built, Cleared, Player.Num());
}

void ACityBuilder::SetHighlight(const FBWParcel* Sel, const FBWParcel* Hover, double ViewDist)
{
	if (Hover == Sel) Hover = nullptr;
	// about 3 px on a 1080-line screen: the band widens as the camera pulls back (1 below 180 m)
	const double Scale = ViewDist > 0 ? FMath::Max(1.0, ViewDist / 14000.0) : HiScale;
	if (Sel == HiSel && Hover == HiHover && Highlight && FMath::Abs(Scale / HiScale - 1) < 0.2) return;
	HiSel = Sel; HiHover = Hover; HiScale = Scale;
	if (!Highlight)
	{
		Highlight = NewObject<UProceduralMeshComponent>(this, TEXT("Highlight"));
		Highlight->SetupAttachment(RootComponent);
		Highlight->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		Highlight->SetCastShadow(false);
		Highlight->RegisterComponent();
	}
	Highlight->ClearAllMeshSections();
	// a band W wide along a closed ring at height Z, laid flat (or, Up, standing as a rim)
	auto Band = [](FMeshBuf& M, const TArray<FVector2D>& Ring, double Z, double W, bool bUp, const FLinearColor& Col)
	{
		const int32 N = Ring.Num();
		for (int32 i = 0; i < N; ++i)
		{
			const FVector2D A = Ring[i], B = Ring[(i + 1) % N];
			const FVector2D Dd = (B - A).GetSafeNormal();
			if (Dd.IsNearlyZero()) continue;
			const FVector2D Nn(-Dd.Y, Dd.X);
			// run a half-width past each corner so the corners close
			const FVector2D A2 = A - Dd * W * 0.5, B2 = B + Dd * W * 0.5;
			const int32 Base = M.V.Num();
			if (bUp)
			{
				M.V.Append({ FVector(A2, Z), FVector(B2, Z), FVector(B2, Z + W), FVector(A2, Z + W) });
				for (int32 k = 0; k < 4; ++k) { M.N.Add(FVector(Nn, 0)); M.C.Add(Col); }
			}
			else
			{
				M.V.Append({ FVector(A2 - Nn * W * 0.5, Z), FVector(B2 - Nn * W * 0.5, Z), FVector(B2 + Nn * W * 0.5, Z), FVector(A2 + Nn * W * 0.5, Z) });
				for (int32 k = 0; k < 4; ++k) { M.N.Add(FVector::UpVector); M.C.Add(Col); }
			}
			M.UV.Append({ FVector2D(0, 0), FVector2D(1, 0), FVector2D(1, 1), FVector2D(0, 1) });
			// both faces, so the band reads from any side
			M.T.Append({ Base, Base + 1, Base + 2, Base, Base + 2, Base + 3, Base, Base + 2, Base + 1, Base, Base + 3, Base + 2 });
		}
	};
	FMeshBuf Gold, White;
	// vertex colours stop at 1: the hue is here, the brightness is the material's Glow
	const FLinearColor GoldC(1.0f, 0.55f, 0.06f), WhiteC(0.85f, 0.85f, 0.85f);
	if (Sel && Sel->Ring.Num() >= 3)
	{
		Band(Gold, Sel->Ring, FootZ + 4, 45 * Scale, false, GoldC);
		for (const FBWVolume& V : Current)
			if (V.Bbl == Sel->Bbl && !V.bVacant && V.Deco.IsEmpty() && V.Ring.Num() >= 3)
				Band(Gold, BWInsetRing(V.Ring, -25 * Scale), V.Z1 - 10, 40 * Scale, true, GoldC);
	}
	if (Hover && Hover->Ring.Num() >= 3) Band(White, Hover->Ring, FootZ + 3, 25 * Scale, false, WhiteC);
	UMaterialInterface* Mat = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/BW/Materials/M_BW_Highlight.M_BW_Highlight"));
	if (!Mat) Mat = LoadObject<UMaterialInterface>(nullptr, TEXT("/Engine/EngineMaterials/EmissiveMeshMaterial.EmissiveMeshMaterial"));
	int32 Sec = 0;
	for (FMeshBuf* M : { &Gold, &White })
	{
		if (!M->V.Num()) continue;
		Highlight->CreateMeshSection_LinearColor(Sec, M->V, M->T, M->N, M->UV, M->C, TArray<FProcMeshTangent>(), false);
		Highlight->SetMaterial(Sec++, Mat);
	}
}

void ACityBuilder::SetPreview(const FString& Bbl, int32 Floors, double Cov, const FString& Facade, const FString& Cls, int32 Year, const FBWLook& Look)
{
	const FBWParcel* P = City.FindParcel(Bbl);
	if (!P || P->Ring.Num() < 3) { ClearPreview(); return; }
	if (BaseVolumes.Num() == 0) BaseVolumes = Current;
	// the web renderer's footprint rule, as ApplyView draws a delivered building
	TArray<FVector2D> Ring = P->Ring;
	FVector2D C(0, 0);
	for (const FVector2D& Q : Ring) C += Q;
	C /= Ring.Num();
	const double B = Cov > 0 ? FMath::Min(0.97, FMath::Sqrt(Cov)) : 0.82;
	for (FVector2D& Q : Ring) Q = C + (Q - C) * B;
	PreviewVol = FBWVolume();
	PreviewVol.Bbl = Bbl;
	PreviewVol.Cls = Cls;
	PreviewVol.Year = Year;
	PreviewVol.Facade = Facade;
	PreviewVol.Look = Look;
	PreviewVol.bCrown = true;
	PreviewVol.Ring = MoveTemp(Ring);
	PreviewVol.Z1 = FMath::Max(1, Floors) * 355.0 + 150.0;   // a parapet's height over the top floor
	bPreview = true;
	ComposePreview();
	BuildVolumes();
}

void ACityBuilder::ClearPreview()
{
	if (!bPreview) return;
	bPreview = false;
	Current = BaseVolumes;
	BuildVolumes();
}

void ACityBuilder::ComposePreview()
{
	Current = BaseVolumes.FilterByPredicate([this](const FBWVolume& V) { return V.Bbl != PreviewVol.Bbl; });
	Current.Add(PreviewVol);
}

bool ACityBuilder::PreviewBounds(FVector& Base, double& Height, double& Span) const
{
	if (!bPreview || PreviewVol.Ring.Num() < 3) return false;
	FBox2D Box(ForceInit);
	for (const FVector2D& Q : PreviewVol.Ring) Box += Q;
	Base = FVector(Box.GetCenter(), 0);
	Height = PreviewVol.Z1;
	Span = Box.GetSize().Size();
	return true;
}

void ACityBuilder::AddCrane(const TArray<FVector2D>& Footprint, double TopCm, uint32 Hash)
{
	if (!Cranes || Footprint.Num() < 3) return;
	FVector2D C(0, 0);
	for (const FVector2D& Q : Footprint) C += Q;
	C /= Footprint.Num();
	// mast two thirds of the way to a corner, jib swung to a yaw fixed by the lot
	const FVector2D Corner = Footprint[Hash % Footprint.Num()];
	const FVector2D Base = C + (Corner - C) * 0.66;
	const double Yaw = double(Hash % 360);
	const FRotator Rot(0, Yaw, 0);
	const FVector Dir = Rot.Vector();
	const double Jib = 4200, Counter = 1400, Section = 180; // cm; the engine cube is 100 cm
	const FVector Top(Base.X, Base.Y, TopCm);
	Cranes->AddInstance(FTransform(FRotator::ZeroRotator, FVector(Base.X, Base.Y, TopCm * 0.5), FVector(Section / 100, Section / 100, TopCm / 100)));
	Cranes->AddInstance(FTransform(Rot, Top + Dir * (Jib * 0.5) + FVector(0, 0, 150), FVector(Jib / 100, 1.4, 1.6)));
	Cranes->AddInstance(FTransform(Rot, Top - Dir * (Counter * 0.5) + FVector(0, 0, 150), FVector(Counter / 100, 1.6, 1.6)));
	Cranes->AddInstance(FTransform(Rot, Top - Dir * (Counter - 250) + FVector(0, 0, 0), FVector(4.0, 3.0, 2.5)));  // ballast
	Cranes->AddInstance(FTransform(Rot, Top + FVector(0, 0, 450), FVector(1.0, 1.0, 6.0)));                       // apex
}

const FBWKit* ACityBuilder::KitFor(const FBWVolume& V) const
{
	// THE STREET READS ITS AGE AND ITS USE. Most of a city's stock is old: pre-war
	// masonry (limestone, multi-colour brick, arches, cornices) for anything put up
	// before ~1945; plain post-war fronts to the mid-70s; curtain wall after.
	// Among the kits that fit, the lot picks (stable, so a building keeps its skin).
	auto Has = [this](const TCHAR* N) { return Kits.FindByPredicate([N](const FBWKit& K) { return K.Name == N; }); };
	// THE WEB MAP'S FAMILY. The building wears what the browser map draws it in:
	// its family lists the kits nearest it, and the lot picks among them (the same
	// pick unreal/tools/facade-families.mjs measures shares with).
	// a kit the player picked on the Build desk, by name
	if (V.Look.IsSet()) if (const FBWKit* Kit = Has(*V.Look.Kit)) return Kit;
	// (a building the player designed wears the style they picked, by the same table)
	const FString& Family = V.Facade.IsEmpty() ? V.Fam : V.Facade;
	if (!Family.IsEmpty())
	{
		const TArray<FString>* List = FamilyKits.Find(Family);
		if (!List) if (const FString* Like = FamilyLike.Find(Family)) List = FamilyKits.Find(*Like);
		if (List && List->Num())
		{
			uint32 H = 2166136261u;
			for (const TCHAR Ch : V.Bbl) { H ^= uint32(Ch); H *= 16777619u; }
			H = (H ^ (H >> 13)) * 0x5bd1e995u;
			for (int32 i = 0; i < List->Num(); ++i)
				if (const FBWKit* Kit = Has(*(*List)[(H + i) % List->Num()])) return Kit;
		}
	}
	// A BUILDING THE PLAYER DESIGNED wears the family they picked on the design
	// desk: each of the web renderer's facade families has the City Sample kit
	// closest to it in material and era.
	if (!V.Facade.IsEmpty())
	{
		static const TMap<FString, const TCHAR*> ByFamily = {
			{ TEXT("brick"), TEXT("NYA") }, { TEXT("brownstone"), TEXT("NYH") }, { TEXT("castiron"), TEXT("CHG") },
			{ TEXT("deco"), TEXT("NYG") }, { TEXT("decobrick"), TEXT("CHI") }, { TEXT("glass"), TEXT("SFC") },
			{ TEXT("loft"), TEXT("CHF") }, { TEXT("modern"), TEXT("SFE") }, { TEXT("moderne"), TEXT("CHH") },
			{ TEXT("ribbon"), TEXT("SFC") }, { TEXT("stone"), TEXT("CHA") }, { TEXT("terracotta"), TEXT("CHC") } };
		if (const TCHAR* const* K = ByFamily.Find(V.Facade)) if (const FBWKit* Kit = Has(*K)) return Kit;
	}
	TArray<const FBWKit*> Fit;
	auto Want = [&](std::initializer_list<const TCHAR*> Names) { for (const TCHAR* N : Names) if (const FBWKit* K = Has(N)) Fit.Add(K); };
	const int32 Y = V.Year;
	const bool bTall = V.Z1 >= 4500;
	if (Y < 1945)
	{
		if (V.Cls == TEXT("office")) { if (bTall) Want({ TEXT("CHA"), TEXT("CHC"), TEXT("NYG") }); else Want({ TEXT("CHC"), TEXT("CHG"), TEXT("NYG"), TEXT("CHA") }); }
		else if (V.Cls == TEXT("multifamily")) Want({ TEXT("NYA"), TEXT("CHI"), TEXT("NYH"), TEXT("CHG") });
		else if (V.Cls == TEXT("retail")) Want({ TEXT("CHI"), TEXT("CHG"), TEXT("NYA"), TEXT("CHF") });
		else Want({ TEXT("CHG"), TEXT("CHH"), TEXT("CHI") });
	}
	else if (Y < 1975)
	{
		if (V.Cls == TEXT("multifamily")) Want({ TEXT("NYH"), TEXT("CHI"), TEXT("CHF") });
		else if (V.Cls == TEXT("office")) Want({ TEXT("CHH"), TEXT("CHC"), TEXT("SFE") });
		else Want({ TEXT("CHF"), TEXT("CHH") });
	}
	else
	{
		if (V.Cls == TEXT("office")) Want({ TEXT("SFC"), TEXT("SFE") });
		else if (V.Cls == TEXT("multifamily")) Want({ TEXT("NYH"), TEXT("SFE"), TEXT("CHF") });
		else Want({ TEXT("SFE"), TEXT("CHF") });
	}
	if (Fit.Num() == 0) for (const FBWKit& K : Kits) Fit.Add(&K);
	return Fit[GetTypeHash(V.Bbl) % Fit.Num()];
}

// ---------------------------------------------------------------- props

namespace
{
	bool InsideRing(const TArray<FVector2D>& R, const FVector2D& P)
	{
		bool In = false;
		for (int32 i = 0, j = R.Num() - 1; i < R.Num(); j = i++)
			if (((R[i].Y > P.Y) != (R[j].Y > P.Y)) && (P.X < (R[j].X - R[i].X) * (P.Y - R[i].Y) / (R[j].Y - R[i].Y) + R[i].X)) In = !In;
		return In;
	}
	const TCHAR* const CarMeshes[] = {
		TEXT("/Game/Vehicle/vehCar_vehicle02/Mesh/SM_vehCar_vehicle02.SM_vehCar_vehicle02"),
		TEXT("/Game/Vehicle/vehCar_vehicle03/Mesh/SM_vehCar_vehicle03.SM_vehCar_vehicle03"),
		TEXT("/Game/Vehicle/vehCar_vehicle05/Mesh/SM_vehCar_vehicle05.SM_vehCar_vehicle05"),
		TEXT("/Game/Vehicle/vehCar_vehicle06/Mesh/SM_vehCar_vehicle06.SM_vehCar_vehicle06"),
		TEXT("/Game/Vehicle/vehCar_vehicle07/Mesh/SM_vehCar_vehicle07.SM_vehCar_vehicle07"),
		TEXT("/Game/Vehicle/vehCar_vehicle12/Mesh/SM_vehCar_vehicle12.SM_vehCar_vehicle12"),
		TEXT("/Game/Vehicle/vehCar_vehicle13/Mesh/SM_vehCar_vehicle13.SM_vehCar_vehicle13"),
		TEXT("/Game/Vehicle/vehVan_vehicle01/Mesh/SM_vehVan_vehicle01.SM_vehVan_vehicle01"),
		TEXT("/Game/Vehicle/vehVan_vehicle09/Mesh/SM_vehVan_vehicle09.SM_vehVan_vehicle09") };
	const TCHAR* const TreeMeshes[] = {
		TEXT("/Game/Prop/Kit_Tree_Alder/Mesh/Tree_Alder_A.Tree_Alder_A"),
		TEXT("/Game/Prop/Kit_Tree_Alder/Mesh/Tree_Alder_B.Tree_Alder_B"),
		TEXT("/Game/Prop/Kit_Tree_Maple_Red/Mesh/Tree_Maple_Red_A.Tree_Maple_Red_A") };
}

void ACityBuilder::AddProp(const TCHAR* Path, const FTransform& T, bool bRoof)
{
	TMap<FString, TObjectPtr<UInstancedStaticMeshComponent>>& Set = bRoof ? RoofProps : StreetProps;
	TObjectPtr<UInstancedStaticMeshComponent>* Found = Set.Find(Path);
	UInstancedStaticMeshComponent* C = Found ? Found->Get() : nullptr;
	if (!C)
	{
		UStaticMesh* Mesh = LoadObject<UStaticMesh>(nullptr, Path);
		if (!Mesh) { Set.Add(Path, nullptr); return; }
		C = NewObject<UInstancedStaticMeshComponent>(this);
		C->SetupAttachment(RootComponent);
		C->SetStaticMesh(Mesh);
		C->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		C->RegisterComponent();
		Set.Add(Path, C);
	}
	C->AddInstance(T);
}

void ACityBuilder::ClearRoofProps()
{
	for (TPair<FString, TObjectPtr<UInstancedStaticMeshComponent>>& P : RoofProps) if (P.Value) P.Value->ClearInstances();
}

void ACityBuilder::BuildStreetProps()
{
	FRandomStream Rng(int32(City.Seed) ^ 0x51ee7);
	// trees where the generator planted them, each in a cast-iron grate
	for (const FVector2D& P : City.Trees)
	{
		const FRotator R(0, Rng.FRandRange(0, 360), 0);
		const double S = Rng.FRandRange(0.85, 1.15);
		AddProp(TreeMeshes[Rng.RandRange(0, 2)], FTransform(R, FVector(P, 4), FVector(S)), false);
		AddProp(TEXT("/Game/Prop/Kit_TreeBase_A/Mesh/SM_TreeBase_SquareGrill_A.SM_TreeBase_SquareGrill_A"), FTransform(R, FVector(P, 3)), false);
	}
	// street lamps along every curb (the sidewalk's outer edge), ~25 m apart, facing the street
	for (const TPair<FString, TArray<TArray<FVector2D>>>& L : City.Ground)
	{
		if (L.Key != TEXT("sidewalk")) continue;
		for (const TArray<FVector2D>& R : L.Value)
		{
			const int32 N = R.Num();
			if (N < 3) continue;
			double Area2 = 0;
			for (int32 i = 0; i < N; ++i) Area2 += R[i].X * R[(i + 1) % N].Y - R[(i + 1) % N].X * R[i].Y;
			for (int32 i = 0; i < N; ++i)
			{
				const FVector2D A = R[i], B = R[(i + 1) % N];
				const double Len = (B - A).Size();
				if (Len < 1500) continue;
				const FVector2D Dir = (B - A) / Len;
				const FVector2D Out = Area2 > 0 ? FVector2D(Dir.Y, -Dir.X) : FVector2D(-Dir.Y, Dir.X);
				const int32 Count = FMath::Max(1, FMath::FloorToInt(Len / 2500));
				for (int32 k = 0; k < Count; ++k)
				{
					const FVector2D P = A + Dir * (Len * (k + 0.5) / Count) - Out * 70; // 70 cm in from the kerb
					if (ParcelAt(P)) continue; // a narrow corner: the kerb line runs up against a building
					const double Yaw = FMath::RadiansToDegrees(FMath::Atan2(Out.Y, Out.X));
					AddProp(TEXT("/Game/Prop/Kit_StreetLamp_B/Mesh/SM_StreetLamp_B.SM_StreetLamp_B"), FTransform(FRotator(0, Yaw, 0), FVector(P, 15)), false);
					if (Rng.FRand() < 0.18)
						AddProp(TEXT("/Game/Prop/Kit_Trashcan_A/Mesh/SM_Trashcan_A_01.SM_Trashcan_A_01"), FTransform(FRotator(0, Yaw, 0), FVector(P + Dir * 180, 15)), false);
				}
				// (kerb parking is laid out by CityLife from the street centrelines, in a
				// parking lane the traffic lane is sized around)
				StreetFurniture(A, Dir, Out, Len, Rng);
			}
		}
	}
}

void ACityBuilder::DressParks(TArray<TArray<FVector2D>>& Paths)
{
	// THE PARK AS THE GENERATOR LAID IT OUT. Its walks (a promenade inside the
	// lawn's edge, the axes, the corner paths, the harbour walk) and its
	// benches come from citygen, so a park here is the park on the web map;
	// its trees come with the city's trees. Drawn here: the walks' paving, the
	// benches, and an iron hoop railing along the lawn's edge, open wherever a
	// walk comes out of the park.
	constexpr double WalkW = 300;
	for (const TArray<FVector2D>& Line : City.ParkPaths)
		for (int32 i = 0; i + 1 < Line.Num(); ++i)
		{
			const FVector2D A = Line[i], B = Line[i + 1];
			const double Len = (B - A).Size();
			if (Len < 50) continue;
			const FVector2D Dd = (B - A) / Len, N(-Dd.Y, Dd.X);
			// each piece runs half a width past its ends, so the joints close
			const FVector2D A2 = A - Dd * WalkW * 0.5, B2 = B + Dd * WalkW * 0.5;
			Paths.Add({ A2 - N * WalkW * 0.5, B2 - N * WalkW * 0.5, B2 + N * WalkW * 0.5, A2 + N * WalkW * 0.5 });
		}
	const TCHAR* const Bench = TEXT("/Game/Prop/Kit_bench_RR/mesh/SM_street_bench.SM_street_bench");
	for (const TPair<FVector2D, double>& Bn : City.Benches)
		// the generator's bearing is the walk's direction in its east-north frame;
		// the seat faces 90 degrees left of it. Here +X is north and +Y east.
		AddProp(Bench, FTransform(FRotator(0, -Bn.Value - 90.0, 0), FVector(Bn.Key, FootZ)), false);
	const TCHAR* const Rail = TEXT("/Game/Prop/Kit_Railing_A/Mesh/SM_Railing_A_Railing_N01.SM_Railing_A_Railing_N01");
	const TCHAR* const Post = TEXT("/Game/Prop/Kit_Railing_A/Mesh/SM_Railing_A_Pole_N01.SM_Railing_A_Pole_N01");
	auto NearWalk = [&](const FVector2D& P)
	{
		for (const TArray<FVector2D>& Line : City.ParkPaths)
			for (int32 i = 0; i + 1 < Line.Num(); ++i)
			{
				const FVector2D A = Line[i], AB = Line[i + 1] - A;
				const double L2 = AB.SizeSquared();
				const double t = L2 > 0 ? FMath::Clamp(FVector2D::DotProduct(P - A, AB) / L2, 0.0, 1.0) : 0.0;
				if ((P - (A + AB * t)).Size() < 400) return true;
			}
		return false;
	};
	for (const TArray<FVector2D>& Edge0 : City.ParkKerbs)
	{
		// the edging runs on the lawn's edge; the railing stands 40 cm inside it
		for (int32 i = 0; i + 1 < Edge0.Num(); ++i)
		{
			const FVector2D A = Edge0[i], B = Edge0[i + 1];
			const double Len = (B - A).Size();
			if (Len < 300) continue;
			const FVector2D Dd = (B - A) / Len;
			const double Yaw = FMath::RadiansToDegrees(FMath::Atan2(Dd.Y, Dd.X));
			for (double t = 0; t + 282 <= Len; t += 282)
			{
				const FVector2D P0 = A + Dd * t, P1 = P0 + Dd * 282;
				if (NearWalk((P0 + P1) * 0.5)) continue;
				AddProp(Rail, FTransform(FRotator(0, Yaw, 0), FVector(P1, FootZ)), false);
				AddProp(Post, FTransform(FRotator(0, Yaw, 0), FVector(P0, FootZ)), false);
			}
		}
	}
}

void ACityBuilder::StreetFurniture(const FVector2D& A, const FVector2D& Dir, const FVector2D& Out, double Len, FRandomStream& Rng)
{
	// WHAT STANDS ON A SIDEWALK, besides lamps and trees, and where a city puts
	// it. Out points to the street; the kerb is the edge line. A piece is skipped
	// where the sidewalk is too narrow and the spot falls on a lot.
	const double Along = FMath::RadiansToDegrees(FMath::Atan2(Dir.Y, Dir.X));
	const double Facing = FMath::RadiansToDegrees(FMath::Atan2(Out.Y, Out.X));
	auto At = [&](double S, double In) { return A + Dir * S - Out * In; };
	auto Free = [&](const FVector2D& P) { return !ParcelAt(P); };
	const FString P0 = TEXT("/Game/Prop/");
	// a bus stop on about one long block face in four, mid-block: the shelter
	// along the kerb, the stop's pole sign at its head, an ad panel behind
	if (Len > 6000 && Rng.FRand() < 0.25)
	{
		const FVector2D P = At(Len * 0.5, 160);
		if (Free(P) && Free(At(Len * 0.5, 260)))
		{
			AddProp(TEXT("/Game/Prop/CITY/Kit_BusStop/Mesh/SM_CTY_BusStop_A01_N1.SM_CTY_BusStop_A01_N1"), FTransform(FRotator(0, Facing + 180, 0), FVector(P, 15)), false);
			AddProp(TEXT("/Game/Prop/Kit_BusStopSign_A/Mesh/SM_BusStopSign_A.SM_BusStopSign_A"), FTransform(FRotator(0, Facing, 0), FVector(At(Len * 0.5 + 420, 60), 15)), false);
			const FVector2D Ad = At(Len * 0.5 - 520, 170);
			const int32 N = Rng.RandRange(1, 4);
			if (Free(Ad)) AddProp(*FString::Printf(TEXT("/Game/Prop/CITY/Kit_StandingSign/Mesh/SM_StandingSignAd_A0%d_N1.SM_StandingSignAd_A0%d_N1"), N, N),
				FTransform(FRotator(0, Along, 0), FVector(Ad, 15)), false);
		}
	}
	// news boxes in a row near the corner, about one corner in six
	if (Len > 1500 && Rng.FRand() < 0.16)
	{
		const FVector2D P = At(380, 90);
		if (Free(P))
		{
			AddProp(Rng.FRand() < 0.5 ? TEXT("/Game/Prop/Kit_NewsDispenser_A/Mesh/SM_NewsDispenser_Small_A_01.SM_NewsDispenser_Small_A_01") : TEXT("/Game/Prop/Kit_NewsDispenser_A/Mesh/SM_NewsDispenser_Large_A_01.SM_NewsDispenser_Large_A_01"),
				FTransform(FRotator(0, Along + 180, 0), FVector(P, 15)), false);
		}
	}
	// a parking-regulation sign on its pole at each block face's start
	if (Len > 1200)
	{
		const FVector2D P = At(260, 45);
		if (Free(P)) AddProp(TEXT("/Game/Prop/Kit_PoleSign_A/Mesh/SM_PoleSign_A.SM_PoleSign_A"), FTransform(FRotator(0, Along, 0), FVector(P, 15)), false);
	}
	// a newsstand on a rare busy corner
	if (Len > 4000 && Rng.FRand() < 0.04)
	{
		const FVector2D P = At(700, 200);
		if (Free(P) && Free(At(700, 300))) AddProp(TEXT("/Game/Prop/Kit_NewsBooth_A/Mesh/SM_NewsBooth_A_01.SM_NewsBooth_A_01"), FTransform(FRotator(0, Facing, 0), FVector(P, 15)), false);
	}
	// bicycles locked along the kerb, a few to a block
	for (double S = 900; S < Len - 900; S += 1700)
		if (Rng.FRand() < 0.07)
		{
			const FVector2D P = At(S, 55);
			if (Free(P)) AddProp(TEXT("/Game/Prop/Kit_Bicycle_A/Mesh/SM_Bicycle_A_01.SM_Bicycle_A_01"), FTransform(FRotator(0, Along + 90 + Rng.FRandRange(-8, 8), 0), FVector(P, 15)), false);
		}
	// cafe tables with an umbrella outside a shop, in the warm months the place
	// keeps them out (they stay: the city is mostly seen from above)
	if (Len > 2000 && Rng.FRand() < 0.10)
	{
		const FVector2D P = At(Len * Rng.FRandRange(0.3, 0.7), 330);
		const FBWParcel* Behind = ParcelAt(At(Len * 0.5, 900));
		if (Free(P) && Behind && Behind->Cls == TEXT("retail"))
		{
			AddProp(TEXT("/Game/Prop/Kit_Umbella_StoneTable_A/Mesh/SM_StoneTable_Circle_A.SM_StoneTable_Circle_A"), FTransform(FRotator(0, Rng.FRandRange(0, 90), 0), FVector(P, 15), FVector(0.55)), false);
			AddProp(TEXT("/Game/Prop/Kit_Umbella_StoneTable_A/Mesh/SM_Umbella_A.SM_Umbella_A"), FTransform(FRotator::ZeroRotator, FVector(P, 15), FVector(0.85)), false);
		}
	}
}

void ACityBuilder::DressRoof(const FBWVolume& V, uint32 Seed)
{
	// ROOFTOPS ARE MACHINE ROOMS. A stair bulkhead on almost every flat roof, a few
	// condensers, an exhaust or two; the wooden water tank on the walk-ups and
	// lofts of the era that needed one (pre-1950, mid-rise).
	if (V.Ring.Num() < 3) return;
	FBox2D Box(ForceInit);
	for (const FVector2D& P : V.Ring) Box += P;
	const FVector2D Sz = Box.GetSize();
	if (Sz.X < 900 || Sz.Y < 900) return;
	const TArray<FVector2D> In = BWInsetRing(V.Ring, 250);
	FRandomStream Rng((int32)Seed);
	auto Spot = [&](FVector2D& Out) { for (int32 t = 0; t < 12; ++t) { const FVector2D P(Rng.FRandRange(Box.Min.X, Box.Max.X), Rng.FRandRange(Box.Min.Y, Box.Max.Y)); if (InsideRing(In, P)) { Out = P; return true; } } return false; };
	const double Z = V.Z1;
	const FRotator Square(0, Rng.RandRange(0, 3) * 90.0 + FMath::RadiansToDegrees(FMath::Atan2(V.Ring[1].Y - V.Ring[0].Y, V.Ring[1].X - V.Ring[0].X)), 0);
	FVector2D P;
	if (Rng.FRand() < 0.85 && Spot(P)) AddProp(TEXT("/Game/Prop/Kit_roof_door_stair_RR/Mesh/SM_roof_door_stair_N1.SM_roof_door_stair_N1"), FTransform(Square, FVector(P, Z)), true);
	const int32 Units = Rng.RandRange(1, FMath::Clamp(int32(Sz.X * Sz.Y / 4.0e6), 1, 6));
	for (int32 i = 0; i < Units; ++i) if (Spot(P)) AddProp(TEXT("/Game/Prop/Kit_roof_AC_Unit_B/Mesh/SM_roof_AC_Unit_B_01_N1.SM_roof_AC_Unit_B_01_N1"), FTransform(Square, FVector(P, Z)), true);
	if (Rng.FRand() < 0.6 && Spot(P)) AddProp(TEXT("/Game/Prop/Kit_roof_Exhaust_A/Mesh/SM_roof_RectExhaust_A_N1.SM_roof_RectExhaust_A_N1"), FTransform(Square, FVector(P, Z)), true);
	for (int32 i = Rng.RandRange(0, 3); i > 0; --i) if (Spot(P)) AddProp(TEXT("/Game/Prop/Kit_Roof_Vent_RR/Mesh/SM_RooftopVent_N1.SM_RooftopVent_N1"), FTransform(Square, FVector(P, Z)), true);
	const double Height = V.Z1 - V.Z0;
	if (V.Year > 0 && V.Year < 1950 && Height > 1500 && Height < 9000 && Rng.FRand() < 0.4 && Spot(P))
		AddProp(Rng.FRand() < 0.5 ? TEXT("/Game/Prop/Kit_roof_tank_a_RR/Mesh/SM_roof_tank_a_N1.SM_roof_tank_a_N1") : TEXT("/Game/Prop/Kit_roof_tank_B_RR/Mesh/SM_roof_tank_b.SM_roof_tank_b"), FTransform(Square, FVector(P, Z)), true);
	// masts on the tall roofs (radio, cellular), a chimney stack or two on the
	// coal-and-oil-heated walk-ups, a switch box by the bulkhead
	if (V.Z1 > 4000 && Rng.FRand() < 0.35 && Spot(P))
		AddProp(Rng.FRand() < 0.5 ? TEXT("/Game/Prop/Kit_antenna_RR/Mesh/SM_roof_antenna_a_N1.SM_roof_antenna_a_N1") : TEXT("/Game/Prop/Kit_antenna_RR/Mesh/SM_roof_antenna_d_N1.SM_roof_antenna_d_N1"), FTransform(Square, FVector(P, Z)), true);
	if (V.Year > 0 && V.Year < 1940 && Height < 2500)
		for (int32 i = Rng.RandRange(0, 2); i > 0; --i) if (Spot(P))
			AddProp(TEXT("/Game/Prop/Kit_roof_brick_RR/Mesh/SM_roof_brick_N1.SM_roof_brick_N1"), FTransform(Square, FVector(P, Z), FVector(1, 1, Rng.FRandRange(1.5, 3.0))), true);
	if (Rng.FRand() < 0.3 && Spot(P))
		AddProp(TEXT("/Game/Prop/Kit_antenna_RR/Mesh/SM_roof_breaker_box_a_N1.SM_roof_breaker_box_a_N1"), FTransform(Square, FVector(P, Z)), true);
}

void ACityBuilder::ParkLot(const FBWVolume& V, uint32 Seed)
{
	// rows of stalls along the lot's first edge, 2.6 m wide, 5.5 m deep, a 7 m aisle
	// between facing rows; a weekday downtown lot runs about two thirds full
	const TArray<FVector2D> In = BWInsetRing(V.Ring, 150);
	if (In.Num() < 3) return;
	const FVector2D Ax = (V.Ring[1] - V.Ring[0]).GetSafeNormal();
	const FVector2D Ay(-Ax.Y, Ax.X);
	double MinA = 1e18, MaxA = -1e18, MinB = 1e18, MaxB = -1e18;
	for (const FVector2D& P : In) { MinA = FMath::Min(MinA, P | Ax); MaxA = FMath::Max(MaxA, P | Ax); MinB = FMath::Min(MinB, P | Ay); MaxB = FMath::Max(MaxB, P | Ay); }
	FRandomStream Rng((int32)Seed);
	const double Yaw = FMath::RadiansToDegrees(FMath::Atan2(Ay.Y, Ay.X));
	int32 Row = 0;
	for (double B = MinB + 275; B < MaxB - 275; B += (Row++ % 2 == 0) ? 550 : 1250)
		for (double A = MinA + 130; A < MaxA - 130; A += 260)
		{
			const FVector2D P = Ax * A + Ay * B;
			if (!InsideRing(In, P) || Rng.FRand() > 0.66) continue;
			AddProp(CarMeshes[Rng.RandRange(0, UE_ARRAY_COUNT(CarMeshes) - 1)], FTransform(FRotator(0, Yaw + (Row % 2 ? 0 : 180), 0), FVector(P, 8)), true);
		}
}

void ACityBuilder::StreetMoment(const FBWVolume& V)
{
	// OPENING DAY: banner poles at the corners for the first three months, the
	// way a developer dresses a new building for its leasing push.
	// A WORKOUT FILE: barricades at the door — the lender's people are inside.
	const int32 N = V.Ring.Num();
	if (N < 3) return;
	FVector2D C(0, 0);
	for (const FVector2D& P : V.Ring) C += P;
	C /= N;
	for (int32 i = 0; i < FMath::Min(N, 6); ++i)
	{
		const FVector2D P = V.Ring[i] + (V.Ring[i] - C).GetSafeNormal() * 180;
		const double Yaw = FMath::RadiansToDegrees(FMath::Atan2(P.Y - C.Y, P.X - C.X));
		if (V.bFresh)
		{
			AddProp(TEXT("/Game/Prop/Kit_StreetLamp_A/Mesh/SM_StreetLamp_A_Pole_Large.SM_StreetLamp_A_Pole_Large"), FTransform(FRotator(0, Yaw, 0), FVector(P, 10)), true);
			AddProp(i % 2 ? TEXT("/Game/Prop/Kit_StreetLamp_A/Mesh/SM_StreetLamp_A_Banner_2.SM_StreetLamp_A_Banner_2") : TEXT("/Game/Prop/Kit_StreetLamp_A/Mesh/SM_StreetLamp_A_Banner.SM_StreetLamp_A_Banner"),
				FTransform(FRotator(0, Yaw, 0), FVector(P, 10)), true);
		}
		else if (i < 2)
			AddProp(TEXT("/Game/Prop/Kit_Barricade_A/Mesh/SM_Barricade_A.SM_Barricade_A"), FTransform(FRotator(0, Yaw + 90, 0), FVector(P, 10)), true);
	}
}

void ACityBuilder::BuildMarkings()
{
	// PAINT, NOT GEOMETRY: thin quads 1 cm above the asphalt layer (z 14) and
	// under the sidewalks (z 18). Highway paint is ~12 cm wide; centre lines are
	// a double yellow; carriageways of 12 m and up get dashed white lane lines
	// (3 m on, 9 m off, the US urban standard); zebra bars are 60 cm.
	FMeshBuf White, Yellow;
	const double Z = 15;
	auto Strip = [Z](FMeshBuf& M, const FVector2D& A, const FVector2D& B, double W, const FLinearColor& Col)
	{
		const FVector2D D = (B - A).GetSafeNormal();
		const FVector2D N(-D.Y, D.X);
		M.AddCap({ A - N * W * 0.5, B - N * W * 0.5, B + N * W * 0.5, A + N * W * 0.5 }, Z, Col);
	};
	const FLinearColor Paint(0.85f, 0.85f, 0.82f), Amber(0.85f, 0.62f, 0.12f);
	for (const FBWCenterline& C : City.Centerlines)
	{
		for (int32 i = 0; i + 1 < C.Line.Num(); ++i)
		{
			const FVector2D A = C.Line[i], B = C.Line[i + 1];
			const double Len = (B - A).Size();
			if (Len < 50) continue;
			const FVector2D D = (B - A) / Len, N(-D.Y, D.X);
			// keep paint out of the intersections at either end
			const double Trim = FMath::Min(900.0, Len * 0.2);
			const FVector2D A2 = A + D * Trim, B2 = B - D * Trim;
			// THE MARKING THE GENERATOR CHOSE (centerline mk): a narrow lane gets no
			// paint, a working street a dashed centre line, an avenue the double
			// yellow and its lane lines. A boulevard's side roadway is one-way: white
			// lane dashes, never a yellow.
			auto Dashes = [&](FMeshBuf& M, double Off, const FLinearColor& Col)
			{
				for (double S = Trim; S + 300 < Len - Trim; S += 900)
					Strip(M, A + D * S + N * Off, A + D * (S + 300) + N * Off, 12, Col);
			};
			if (C.Cls == TEXT("boulevard")) Dashes(White, 0, Paint);
			else if (C.Mark >= 2)
			{
				Strip(Yellow, A2 + N * 15, B2 + N * 15, 12, Amber);
				Strip(Yellow, A2 - N * 15, B2 - N * 15, 12, Amber);
				for (const double Off : { -C.Width * 0.25, C.Width * 0.25 }) Dashes(White, Off, Paint);
			}
			else if (C.Mark == 1) Dashes(Yellow, 0, Amber);
		}
	}
	for (const TArray<FVector2D>& Zb : City.Zebras)
		if (Zb.Num() >= 2) Strip(White, Zb[0], Zb.Last(), 60, Paint);

	UProceduralMeshComponent* Marks = NewObject<UProceduralMeshComponent>(this, TEXT("Markings"));
	Marks->SetupAttachment(RootComponent);
	Marks->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Marks->SetCastShadow(false);
	Marks->RegisterComponent();
	if (White.V.Num()) { White.Emit(Marks, 0, false); Marks->SetMaterial(0, VertexColorMaterial); }
	if (Yellow.V.Num()) { Yellow.Emit(Marks, 1, false); Marks->SetMaterial(1, VertexColorMaterial); }
	UE_LOG(LogBWBuilder, Display, TEXT("markings: %d centrelines, %d zebra bars"), City.Centerlines.Num(), City.Zebras.Num());
}

void ACityBuilder::BuildTraffic()
{
	FRandomStream Rng(int32(City.Seed) ^ 0x7aff1c);
	// lanes: drive on the right; a carriageway of 12 m+ has two lanes each way
	for (const FBWCenterline& C : City.Centerlines)
	{
		if (C.Line.Num() < 2 || C.Width < 600) continue;
		const int32 PerDir = C.Width >= 1200 ? 2 : 1;
		for (int32 Dir = 0; Dir < 2; ++Dir)
			for (int32 k = 0; k < PerDir; ++k)
			{
				const double Off = C.Width * (0.5 * (k + 0.5) / PerDir);   // metres right of the centre, by lane
				FLane L;
				const int32 N = C.Line.Num();
				for (int32 i = 0; i < N; ++i)
				{
					const int32 j = Dir == 0 ? i : N - 1 - i;
					const FVector2D P = C.Line[j];
					const FVector2D Nx = (Dir == 0 ? (j + 1 < N ? C.Line[j + 1] - P : P - C.Line[j - 1]) : (j > 0 ? C.Line[j - 1] - P : P - C.Line[j + 1])).GetSafeNormal();
					L.Pts.Add(P + FVector2D(Nx.Y, -Nx.X) * Off * 0.5);       // right of travel
				}
				L.Cum.Add(0);
				for (int32 i = 1; i < L.Pts.Num(); ++i) L.Cum.Add(L.Cum.Last() + (L.Pts[i] - L.Pts[i - 1]).Size());
				L.Len = L.Cum.Last();
				if (L.Len > 1500) Lanes.Add(MoveTemp(L));
			}
	}
	for (const TCHAR* Path : CarMeshes)
	{
		UStaticMesh* Mesh = LoadObject<UStaticMesh>(nullptr, Path);
		UInstancedStaticMeshComponent* I = NewObject<UInstancedStaticMeshComponent>(this);
		I->SetupAttachment(RootComponent);
		I->SetStaticMesh(Mesh);
		I->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		I->SetMobility(EComponentMobility::Movable);
		I->RegisterComponent();
		TrafficMeshes.Add(I);
	}
	for (int32 l = 0; l < Lanes.Num(); ++l)
	{
		// a car every ~40 m of lane on average, each at its own pace (32-47 km/h)
		// off-peak downtown: about one car per 160 m of lane (most short block lanes carry none)
		const int32 Count = Rng.FRand() < Lanes[l].Len / 16000.0 ? FMath::Max(1, FMath::FloorToInt(Lanes[l].Len / 16000.0)) : 0;
		for (int32 n = 0; n < Count; ++n)
		{
			FCar Car;
			Car.Lane = l;
			Car.S = Rng.FRandRange(0, Lanes[l].Len);
			Car.Speed = Rng.FRandRange(900, 1300);
			Car.Mesh = Rng.RandRange(0, TrafficMeshes.Num() - 1);
			Car.Instance = TrafficMeshes[Car.Mesh]->AddInstance(FTransform::Identity);
			Cars.Add(Car);
		}
	}
	UE_LOG(LogBWBuilder, Display, TEXT("traffic: %d lanes, %d cars"), Lanes.Num(), Cars.Num());
}

void ACityBuilder::Tick(float Dt)
{
	Super::Tick(Dt);
	if (Cars.Num() == 0) return;
	TArray<TArray<FTransform>> Xf;
	Xf.SetNum(TrafficMeshes.Num());
	for (UInstancedStaticMeshComponent* I : TrafficMeshes) Xf[TrafficMeshes.IndexOfByKey(I)].SetNum(I ? I->GetInstanceCount() : 0);
	for (FCar& Car : Cars)
	{
		const FLane& L = Lanes[Car.Lane];
		Car.S = FMath::Fmod(Car.S + Car.Speed * Dt, L.Len);
		int32 i = 1;
		while (i < L.Cum.Num() - 1 && L.Cum[i] < Car.S) ++i;
		const double T = (Car.S - L.Cum[i - 1]) / FMath::Max(1.0, L.Cum[i] - L.Cum[i - 1]);
		const FVector2D P = FMath::Lerp(L.Pts[i - 1], L.Pts[i], T);
		const FVector2D Fw = (L.Pts[i] - L.Pts[i - 1]).GetSafeNormal();
		if (Xf[Car.Mesh].IsValidIndex(Car.Instance))
			Xf[Car.Mesh][Car.Instance] = FTransform(FRotator(0, FMath::RadiansToDegrees(FMath::Atan2(Fw.Y, Fw.X)), 0), FVector(P, 14));
	}
	for (int32 m = 0; m < TrafficMeshes.Num(); ++m)
		if (TrafficMeshes[m] && Xf[m].Num()) TrafficMeshes[m]->BatchUpdateInstancesTransforms(0, Xf[m], true, true);
}
