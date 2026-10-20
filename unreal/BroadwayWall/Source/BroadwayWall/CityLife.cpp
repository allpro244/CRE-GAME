#include "CityLife.h"

#include "CityData.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"

DEFINE_LOG_CATEGORY_STATIC(LogBWLife, Log, All);

namespace
{
	const TCHAR* const Vehicles[] = {
		TEXT("/Game/Vehicle/vehCar_vehicle02/Mesh/SM_vehCar_vehicle02.SM_vehCar_vehicle02"),
		TEXT("/Game/Vehicle/vehCar_vehicle03/Mesh/SM_vehCar_vehicle03.SM_vehCar_vehicle03"),
		TEXT("/Game/Vehicle/vehCar_vehicle05/Mesh/SM_vehCar_vehicle05.SM_vehCar_vehicle05"),
		TEXT("/Game/Vehicle/vehCar_vehicle06/Mesh/SM_vehCar_vehicle06.SM_vehCar_vehicle06"),
		TEXT("/Game/Vehicle/vehCar_vehicle07/Mesh/SM_vehCar_vehicle07.SM_vehCar_vehicle07"),
		TEXT("/Game/Vehicle/vehCar_vehicle12/Mesh/SM_vehCar_vehicle12.SM_vehCar_vehicle12"),
		TEXT("/Game/Vehicle/vehCar_vehicle13/Mesh/SM_vehCar_vehicle13.SM_vehCar_vehicle13"),
		TEXT("/Game/Vehicle/vehVan_vehicle01/Mesh/SM_vehVan_vehicle01.SM_vehVan_vehicle01"),
		TEXT("/Game/Vehicle/vehVan_vehicle09/Mesh/SM_vehVan_vehicle09.SM_vehVan_vehicle09") };

	// signal cycle: axis 0 green, all red, axis 1 green, all red (seconds)
	constexpr double GreenT = 14, ClearT = 3, Cycle = 2 * (GreenT + ClearT);
	constexpr double StopBack = 650;   // stop line, cm before the node
	constexpr double CarLen = 520, MinGap = 250, TimeGap = 1.2;
	// THE STREET'S CROSS-SECTION, kerb to kerb: a parking lane 2.4 m wide against
	// each kerb on streets of 10 m and more, the travel lane centred in what is
	// left on its side. One rule for both, so a moving car can never be laid out
	// through a parked one.
	constexpr double ParkW = 240;
	bool HasParking(double W) { return W >= 1000; }
	double TravelOffset(double W) { const double Half = W * 0.5 - (HasParking(W) ? ParkW : 0); return FMath::Max(120.0, Half * 0.5); }

	void Cumulate(const TArray<FVector2D>& P, TArray<double>& Cum, double& Len)
	{
		Cum.Reset();
		Cum.Add(0);
		for (int32 i = 1; i < P.Num(); ++i) Cum.Add(Cum.Last() + (P[i] - P[i - 1]).Size());
		Len = Cum.Last();
	}

	FVector2D AlongPath(const TArray<FVector2D>& P, const TArray<double>& Cum, double S, FVector2D* Dir)
	{
		int32 i = 1;
		while (i < Cum.Num() - 1 && Cum[i] < S) ++i;
		const double T = FMath::Clamp((S - Cum[i - 1]) / FMath::Max(1.0, Cum[i] - Cum[i - 1]), 0.0, 1.0);
		if (Dir) *Dir = (P[i] - P[i - 1]).GetSafeNormal();
		return FMath::Lerp(P[i - 1], P[i], T);
	}

	TArray<FVector2D> OffsetRight(const TArray<FVector2D>& P, double Off)
	{
		TArray<FVector2D> O;
		for (int32 i = 0; i < P.Num(); ++i)
		{
			const FVector2D D = (i + 1 < P.Num() ? P[i + 1] - P[i] : P[i] - P[i - 1]).GetSafeNormal();
			O.Add(P[i] + FVector2D(D.Y, -D.X) * Off);
		}
		return O;
	}
}

ACityLife::ACityLife()
{
	PrimaryActorTick.bCanEverTick = true;
	RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
}

FVector2D ACityLife::At(const FLane& L, double S, FVector2D* Dir) const { return AlongPath(L.Pts, L.Cum, S, Dir); }

bool ACityLife::Green(int32 Node, int32 Axis) const
{
	if (!Nodes[Node].bSignal) return true;
	// offset each intersection's cycle so a whole avenue does not change at once
	const double T = FMath::Fmod(Clock + Node * 7.3, Cycle);
	return Axis == 0 ? T < GreenT : (T >= GreenT + ClearT && T < 2 * GreenT + ClearT);
}

int32 ACityLife::PieceMesh(const FString& Path)
{
	if (const int32* I = PersonMeshIndex.Find(Path)) return *I;
	UStaticMesh* M = LoadObject<UStaticMesh>(nullptr, *Path);
	if (!M) { PersonMeshIndex.Add(Path, INDEX_NONE); return INDEX_NONE; }
	UInstancedStaticMeshComponent* C = NewObject<UInstancedStaticMeshComponent>(this);
	C->SetupAttachment(RootComponent);
	C->SetStaticMesh(M);
	C->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	C->SetMobility(EComponentMobility::Movable);
	C->NumCustomDataFloats = 5;
	C->SetCastShadow(true);
	C->RegisterComponent();
	const int32 I = PersonMeshes.Add(C);
	PersonMeshIndex.Add(Path, I);
	return I;
}

void ACityLife::Build(const FBWCity& City, int32 Seed)
{
	FRandomStream Rng(Seed ^ 0x11fe);
	int32 Parked = 0;

	// ---------------- road graph
	TMap<FIntPoint, int32> NodeAt;
	auto NodeFor = [&](const FVector2D& P)
	{
		// ends within ~4 m are the same junction
		const FIntPoint K(FMath::RoundToInt(P.X / 400.0), FMath::RoundToInt(P.Y / 400.0));
		for (int32 dx = -1; dx <= 1; ++dx) for (int32 dy = -1; dy <= 1; ++dy)
			if (const int32* N = NodeAt.Find(K + FIntPoint(dx, dy))) if ((Nodes[*N].P - P).SizeSquared() < 400.0 * 400.0) return *N;
		const int32 N = Nodes.Add({ P });
		NodeAt.Add(K, N);
		return N;
	};
	for (const FBWCenterline& C : City.Centerlines)
	{
		if (C.Line.Num() < 2 || C.Width < 600) continue;
		const int32 A = NodeFor(C.Line[0]), B = NodeFor(C.Line.Last());
		if (A == B) continue;
		const double Off = TravelOffset(C.Width);   // centre of the right-hand travel lane
		TArray<FVector2D> Fw = C.Line;
		TArray<FVector2D> Bw = C.Line;
		Algo::Reverse(Bw);
		const int32 L0 = Lanes.Num();
		for (int32 d = 0; d < 2; ++d)
		{
			FLane L;
			L.From = d ? B : A; L.To = d ? A : B;
			L.Pts = OffsetRight(d ? Bw : Fw, Off);
			Cumulate(L.Pts, L.Cum, L.Len);
			const FVector2D H = (L.Pts.Last() - L.Pts[L.Pts.Num() - 2]).GetSafeNormal();
			L.Axis = FMath::Abs(H.X) >= FMath::Abs(H.Y) ? 0 : 1;
			Lanes.Add(MoveTemp(L));
		}
		Lanes[L0].Twin = L0 + 1; Lanes[L0 + 1].Twin = L0;
		Nodes[Lanes[L0].From].Out.Add(L0);
		Nodes[Lanes[L0 + 1].From].Out.Add(L0 + 1);
	}
	for (FNode& N : Nodes) N.bSignal = N.Out.Num() >= 3;

	for (int32 Pass = 0; Pass < 2; ++Pass)
	for (const TCHAR* P : Vehicles)
	{
		UInstancedStaticMeshComponent* I = NewObject<UInstancedStaticMeshComponent>(this);
		I->SetupAttachment(RootComponent);
		I->SetStaticMesh(LoadObject<UStaticMesh>(nullptr, P));
		I->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		I->SetMobility(Pass ? EComponentMobility::Movable : EComponentMobility::Static);
		I->RegisterComponent();
		(Pass ? CarMeshes : ParkedMeshes).Add(I);
	}
	// parked cars: in the parking lane, a stall every 6.5 m, about half taken,
	// clear of the junctions at either end (crosswalks, turning room)
	for (const FBWCenterline& C : City.Centerlines)
	{
		if (C.Line.Num() < 2 || !HasParking(C.Width)) continue;
		TArray<double> Cum; double Len = 0;
		Cumulate(C.Line, Cum, Len);
		const double Kerb = C.Width * 0.5 - ParkW * 0.5;
		for (int32 Side = -1; Side <= 1; Side += 2)
			for (double S = 1100; S < Len - 1100; S += 650)
			{
				if (Rng.FRand() > 0.5) continue;
				FVector2D Dir;
				const FVector2D P = AlongPath(C.Line, Cum, S, &Dir);
				const FVector2D Right(Dir.Y, -Dir.X);
				const FVector2D At2 = P + Right * Kerb * Side;
				// parked facing the traffic on its side of the street
				const double Yaw = FMath::RadiansToDegrees(FMath::Atan2(Dir.Y, Dir.X)) + (Side > 0 ? 0 : 180);
				UInstancedStaticMeshComponent* M = ParkedMeshes[Rng.RandRange(0, ParkedMeshes.Num() - 1)];
				M->AddInstance(FTransform(FRotator(0, Yaw, 0), FVector(At2, 14)));
				++Parked;
			}
	}
	int32 Signals = 0;
	for (const FNode& N : Nodes) Signals += N.bSignal ? 1 : 0;
	// off-peak downtown: about one car per 90 m of lane, spaced along it
	for (int32 l = 0; l < Lanes.Num(); ++l)
	{
		FLane& L = Lanes[l];
		if (L.Len < 2500) continue;
		const int32 Count = FMath::FloorToInt(L.Len / 9000.0 * Rng.FRandRange(0.5, 1.5));
		for (int32 n = 0; n < Count; ++n)
		{
			FCar C;
			C.Lane = l;
			C.S = (L.Len - StopBack) * (n + Rng.FRandRange(0.1, 0.9)) / FMath::Max(1, Count);
			C.V0 = Rng.FRandRange(950, 1250);
			C.V = C.V0 * 0.5;
			C.Mesh = Rng.RandRange(0, CarMeshes.Num() - 1);
			C.Inst = CarMeshes[C.Mesh]->AddInstance(FTransform::Identity);
			L.Cars.Add(Cars.Add(C));
		}
	}

	// ---------------- people
	if (!FParse::Param(FCommandLine::Get(), TEXT("NoCrowd")))
	{
		for (const TPair<FString, TArray<TArray<FVector2D>>>& G : City.Ground)
		{
			if (G.Key != TEXT("sidewalk")) continue;
			for (const TArray<FVector2D>& R : G.Value)
			{
				if (R.Num() < 3) continue;
				// walk ~2 m in from the kerb (the ring's outer edge), around the block
				double Area2 = 0;
				for (int32 i = 0; i < R.Num(); ++i) Area2 += R[i].X * R[(i + 1) % R.Num()].Y - R[(i + 1) % R.Num()].X * R[i].Y;
				FWalk W;
				for (int32 i = 0; i < R.Num(); ++i)
				{
					const FVector2D P = R[i], A = R[(i + R.Num() - 1) % R.Num()], B = R[(i + 1) % R.Num()];
					const FVector2D D0 = (P - A).GetSafeNormal(), D1 = (B - P).GetSafeNormal();
					FVector2D In = (Area2 > 0 ? FVector2D(-D0.Y, D0.X) + FVector2D(-D1.Y, D1.X) : FVector2D(D0.Y, -D0.X) + FVector2D(D1.Y, -D1.X)).GetSafeNormal();
					W.Pts.Add(P + In * 200);
				}
				const FVector2D First = W.Pts[0]; // (not Add(W.Pts[0]): the array may grow under the reference)
				W.Pts.Add(First);
				Cumulate(W.Pts, W.Cum, W.Len);
				if (W.Len > 4000) Walks.Add(MoveTemp(W));
			}
		}
		const FString V = TEXT("/Game/Crowd/VAT/Meshes/");
		const TArray<FString> FTops = { TEXT("buttonDown"), TEXT("buttonDown_blazer"), TEXT("scoopneck"), TEXT("turtleneck"), TEXT("turtleneck_blazer") };
		const TArray<FString> FBottoms = { TEXT("jeans"), TEXT("slacks"), TEXT("skirt") };
		const TArray<FString> FShoes = { TEXT("loafers"), TEXT("oxfords"), TEXT("dressFlats") };
		const TArray<FString> MTops = { TEXT("buttonDown"), TEXT("buttonDown_blazer"), TEXT("crewneck"), TEXT("crewneck_blazer"), TEXT("turtleneck"), TEXT("buttonDown_tie_blazer") };
		const TArray<FString> MBottoms = { TEXT("jeans"), TEXT("slacks") };
		const TArray<FString> MShoes = { TEXT("loafers"), TEXT("oxfords") };
		const TArray<FString> FHair = { TEXT("Hair_M_BobCurly_Helmet_LOD5"), TEXT("Hair_S_LowPonytail_Helmet_LOD5"), TEXT("Hair_S_Pixie_Mesh_LOD5"), TEXT("Hair_S_Updo_Helmet_LOD5"), TEXT("Hair_S_Coil_Helmet_LOD5") };
		const TArray<FString> MHair = { TEXT("Hair_S_AfroFade_Helmet_LOD5"), TEXT("Hair_S_CurlyFade_Helmet_LOD5"), TEXT("Hair_S_HairLoss_Helmet_LOD5"), TEXT("Hair_M_SideSweptFringe_Mesh_LOD5") };
		auto Path = [&V](const FString& N) { return V + N + TEXT(".") + N; };
		for (int32 w = 0; w < Walks.Num(); ++w)
		{
			// a person every ~35 m of sidewalk, walking either way round the block
			const int32 Count = FMath::FloorToInt(Walks[w].Len / 3500.0 * Rng.FRandRange(0.4, 1.6));
			for (int32 n = 0; n < Count; ++n)
			{
				FPerson P;
				P.Walk = w;
				P.S = Rng.FRandRange(0, Walks[w].Len);
				P.V = Rng.FRandRange(115, 150);           // 1.15-1.5 m/s, a city stroll
				P.Dir = Rng.FRand() < 0.5 ? 1 : -1;
				const bool bF = Rng.FRand() < 0.5;
				const FString G = bF ? TEXT("f") : TEXT("m");
				TArray<FString> Parts = {
					FString::Printf(TEXT("SM_%s_tal_nrw_body"), *G),
					FString::Printf(TEXT("SM_%s_tal_nrw_%s"), *G, *(bF ? FTops : MTops)[Rng.RandRange(0, (bF ? FTops : MTops).Num() - 1)]),
					FString::Printf(TEXT("SM_%s_tal_nrw_%s"), *G, *(bF ? FBottoms : MBottoms)[Rng.RandRange(0, (bF ? FBottoms : MBottoms).Num() - 1)]),
					FString::Printf(TEXT("SM_%s_tal_nrw_%s"), *G, *(bF ? FShoes : MShoes)[Rng.RandRange(0, (bF ? FShoes : MShoes).Num() - 1)]),
					FString::Printf(TEXT("SM_%s_00%d_nrw_FaceMesh"), *G, Rng.RandRange(1, 5)),
					(bF ? FHair : MHair)[Rng.RandRange(0, (bF ? FHair : MHair).Num() - 1)] };
				// walk clip (frames 0-319), each person at their own phase
				const float Anim[5] = { 0.f, 320.f, float(P.V / 130.0), 1.f, float(Rng.FRandRange(0, 30)) };
				for (const FString& Part : Parts)
				{
					const int32 M = PieceMesh(Path(Part));
					if (M == INDEX_NONE) continue;
					const int32 I = PersonMeshes[M]->AddInstance(FTransform::Identity);
					PersonMeshes[M]->SetCustomData(I, TArrayView<const float>(Anim, 5));
					P.Pieces.Add({ M, I });
				}
				if (P.Pieces.Num()) People.Add(MoveTemp(P));
			}
		}
	}
	UE_LOG(LogBWLife, Display, TEXT("city life: %d junctions (%d signalled), %d lanes, %d moving cars, %d parked; %d sidewalk loops, %d people"),
		Nodes.Num(), Signals, Lanes.Num(), Cars.Num(), Parked, Walks.Num(), People.Num());
}

void ACityLife::Tick(float Dt)
{
	Super::Tick(Dt);
	Dt = FMath::Min(Dt, 0.1f);
	Clock += Dt;

	// ---------------- cars
	TArray<TArray<FTransform>> Xf;
	Xf.SetNum(CarMeshes.Num());
	for (int32 m = 0; m < CarMeshes.Num(); ++m) Xf[m].SetNum(CarMeshes[m]->GetInstanceCount());
	for (FLane& L : Lanes) L.Cars.Sort([this](int32 A, int32 B) { return Cars[A].S > Cars[B].S; }); // leader first
	for (FLane& L : Lanes)
	{
		for (int32 k = 0; k < L.Cars.Num(); ++k)
		{
			FCar& C = Cars[L.Cars[k]];
			// the gap to whatever is ahead: the car in front, or the stop line on red
			double Gap = 1e9;
			if (k > 0) Gap = Cars[L.Cars[k - 1]].S - C.S - CarLen;
			const double ToLine = L.Len - StopBack - C.S;
			if (!Green(L.To, L.Axis) && ToLine > -50) Gap = FMath::Min(Gap, ToLine);
			// a car following at a time gap; decelerate to stop inside the gap
			const double Safe = MinGap + C.V * TimeGap;
			const double Target = Gap < Safe ? FMath::Max(0.0, C.V0 * (Gap - MinGap) / FMath::Max(1.0, Safe - MinGap)) : C.V0;
			C.V = FMath::FInterpTo(C.V, Target, Dt, Target < C.V ? 4.0 : 0.8);
			if (Gap < MinGap * 0.5) C.V = 0;
			C.S += C.V * Dt;
		}
	}
	// lane changes at the ends: pick an onward street, not a U-turn
	for (int32 c = 0; c < Cars.Num(); ++c)
	{
		FCar& C = Cars[c];
		FLane& L = Lanes[C.Lane];
		if (C.S < L.Len) continue;
		const FNode& N = Nodes[L.To];
		TArray<int32, TInlineAllocator<6>> Options;
		for (int32 o : N.Out) if (o != L.Twin) Options.Add(o);
		if (Options.Num() == 0) Options.Add(L.Twin);
		const int32 Next = Options[FMath::RandRange(0, Options.Num() - 1)];
		// the next street's tail must have room for us, or we wait at the line
		bool bRoom = true;
		for (int32 o : Lanes[Next].Cars) if (Cars[o].S < CarLen + MinGap) { bRoom = false; break; }
		if (!bRoom) { C.S = L.Len; C.V = 0; continue; }
		L.Cars.Remove(c);
		C.S -= L.Len;
		C.Lane = Next;
		Lanes[Next].Cars.Add(c);
	}
	for (const FCar& C : Cars)
	{
		FVector2D Dir;
		const FVector2D P = At(Lanes[C.Lane], FMath::Min(C.S, Lanes[C.Lane].Len), &Dir);
		if (Xf[C.Mesh].IsValidIndex(C.Inst))
			Xf[C.Mesh][C.Inst] = FTransform(FRotator(0, FMath::RadiansToDegrees(FMath::Atan2(Dir.Y, Dir.X)), 0), FVector(P, 14));
	}
	for (int32 m = 0; m < CarMeshes.Num(); ++m) if (Xf[m].Num()) CarMeshes[m]->BatchUpdateInstancesTransforms(0, Xf[m], true, true);

	// ---------------- people
	if (People.Num())
	{
		TArray<TArray<FTransform>> Px;
		Px.SetNum(PersonMeshes.Num());
		for (int32 m = 0; m < PersonMeshes.Num(); ++m) Px[m].SetNum(PersonMeshes[m]->GetInstanceCount());
		for (FPerson& P : People)
		{
			const FWalk& W = Walks[P.Walk];
			P.S = FMath::Fmod(P.S + P.Dir * P.V * Dt + W.Len, W.Len);
			FVector2D Dir;
			const FVector2D At2 = AlongPath(W.Pts, W.Cum, P.S, &Dir);
			if (P.Dir < 0) Dir = -Dir;
			// the crowd meshes face +Y (skeletal convention): turn them to face along X
			const FTransform T(FRotator(0, FMath::RadiansToDegrees(FMath::Atan2(Dir.Y, Dir.X)) - 90.0, 0), FVector(At2, 17));
			for (const TPair<int32, int32>& Pc : P.Pieces) if (Px[Pc.Key].IsValidIndex(Pc.Value)) Px[Pc.Key][Pc.Value] = T;
		}
		for (int32 m = 0; m < PersonMeshes.Num(); ++m) if (Px[m].Num()) PersonMeshes[m]->BatchUpdateInstancesTransforms(0, Px[m], true, true);
	}
}

bool ACityLife::PersonNear(const FVector& Q, FVector& Out, FVector2D& Facing) const
{
	double Best = 1e18;
	for (const FPerson& P : People)
	{
		FVector2D D;
		const FVector2D X = AlongPath(Walks[P.Walk].Pts, Walks[P.Walk].Cum, P.S, &D);
		const double Dd = FVector2D::DistSquared(X, FVector2D(Q));
		if (Dd < Best) { Best = Dd; Out = FVector(X, 17); Facing = P.Dir > 0 ? D : -D; }
	}
	return Best < 1e18;
}
