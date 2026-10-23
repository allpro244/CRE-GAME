#include "HouseBuilder.h"
#include "Misc/PackageName.h"

namespace
{
#define HK(n) TEXT("/Game/BW/Homes/" n "." n)
#define HKM(n) TEXT("/Game/BW/Homes/Mats/MI_HK_" n ".MI_HK_" n)
#define FGM(folder, n) TEXT("/Game/Building/Material/MI/" folder "/ForGym/MI_Bldg_" n "_FG.MI_Bldg_" n "_FG")

	/** A house type: its meshes (and the mirror, garage at the other end), its nominal footprint (front width W
	 *  along X, depth D), where its garage door is (X, and the door's Y), and whether it wants a garage out back. */
	struct FStyle
	{
		const TCHAR* Mesh;
		const TCHAR* Mirror;
		double W, D;
		bool bGarage;
		double GX, GY;
		bool bBack;
	};
	enum EStyle { Bungalow, Foursquare, Cape, Ranch, RanchGable, SplitLevel, Colonial, Farmhouse, NumStyles };
	const FStyle Styles[NumStyles] = {
		{ HK("SM_HK_Bungalow"), nullptr, 1000, 1300, false, 0, 0, true },
		{ HK("SM_HK_Foursquare"), nullptr, 1000, 1000, false, 0, 0, true },
		{ HK("SM_HK_Cape"), nullptr, 1100, 800, false, 0, 0, true },
		{ HK("SM_HK_Ranch"), HK("SM_HK_Ranch_R"), 1500, 900, true, 500, 350, false },
		{ HK("SM_HK_RanchGable"), HK("SM_HK_RanchGable_R"), 1500, 900, true, 500, 350, false },
		{ HK("SM_HK_SplitLevel"), HK("SM_HK_SplitLevel_R"), 1400, 900, true, -400, 450, false },
		{ HK("SM_HK_Colonial"), HK("SM_HK_Colonial_R"), 1300, 900, true, 450, 330, false },
		{ HK("SM_HK_Farmhouse"), HK("SM_HK_Farmhouse_R"), 1300, 900, true, 475, 250, false },
	};
	/** Which types a year builds (US single-family by era), the first the commonest. */
	TArray<EStyle> EraStyles(int32 Y)
	{
		if (Y <= 0) Y = 1955;
		if (Y < 1935) return { Bungalow, Foursquare, Bungalow, Cape };
		if (Y < 1946) return { Cape, Bungalow };
		if (Y < 1960) return { Ranch, RanchGable, Cape };
		if (Y < 1975) return { RanchGable, Ranch, SplitLevel };
		if (Y < 1990) return { SplitLevel, Colonial, RanchGable };
		if (Y < 2005) return { Colonial, Colonial, SplitLevel };
		return { Farmhouse, Colonial };
	}
	/** An era's cladding and its roofs: (wall, door) pairs, and shingles. */
	struct FPalette { TArray<TPair<const TCHAR*, const TCHAR*>> Walls; TArray<const TCHAR*> Roofs; };
	FPalette PaletteOf(int32 Y, EStyle S)
	{
		FPalette P;
		const TCHAR* Brick = FGM("Brick", "BrickOffset_Red");
		const TCHAR* BrickBrown = FGM("Brick", "BrickOffset_Brown");
		if (S == Farmhouse)
		{
			P.Walls = { { HKM("SidingWhite"), HKM("DoorBlack") }, { HKM("SidingWhite"), HKM("DoorBlack") }, { HKM("SidingSlate"), HKM("DoorRed") } };
			P.Roofs = { HKM("ShingleCharcoal") };
		}
		else if (Y < 1946)
		{
			P.Walls = { { HKM("SidingWhite"), HKM("DoorGreen") }, { HKM("SidingCream"), HKM("DoorRed") }, { HKM("SidingYellow"), HKM("DoorNavy") },
				{ HKM("SidingGreen"), HKM("DoorRed") }, { Brick, HKM("DoorGreen") }, { HKM("Stucco"), HKM("DoorBlack") } };
			P.Roofs = { HKM("ShingleCharcoal"), HKM("ShingleGreen"), HKM("ShingleRed"), HKM("ShingleBrown") };
		}
		else if (Y < 1975)
		{
			P.Walls = { { Brick, HKM("DoorBlack") }, { HKM("SidingWhite"), HKM("DoorRed") }, { HKM("SidingBlue"), HKM("DoorNavy") },
				{ HKM("SidingYellow"), HKM("DoorGreen") }, { TEXT("/Game/BW/Mats/MI_BW_BrickOrange.MI_BW_BrickOrange"), HKM("DoorBlack") }, { HKM("SidingGreen"), HKM("DoorRed") } };
			P.Roofs = { HKM("ShingleCharcoal"), HKM("ShingleBrown"), HKM("ShingleGrey") };
		}
		else if (Y < 1995)
		{
			P.Walls = { { HKM("SidingTan"), HKM("DoorRed") }, { HKM("SidingCream"), HKM("DoorNavy") }, { BrickBrown, HKM("DoorBlack") }, { HKM("SidingGrey"), HKM("DoorRed") } };
			P.Roofs = { HKM("ShingleBrown"), HKM("ShingleCharcoal") };
		}
		else
		{
			P.Walls = { { HKM("SidingGrey"), HKM("DoorBlack") }, { HKM("SidingWhite"), HKM("DoorNavy") }, { HKM("SidingCream"), HKM("DoorRed") }, { HKM("SidingSlate"), HKM("DoorBlack") } };
			P.Roofs = { HKM("ShingleCharcoal"), HKM("ShingleGrey") };
		}
		return P;
	}
	const TCHAR* const Cars[] = {
		TEXT("/Game/Vehicle/vehCar_vehicle02/Mesh/SM_vehCar_vehicle02.SM_vehCar_vehicle02"),
		TEXT("/Game/Vehicle/vehCar_vehicle03/Mesh/SM_vehCar_vehicle03.SM_vehCar_vehicle03"),
		TEXT("/Game/Vehicle/vehCar_vehicle05/Mesh/SM_vehCar_vehicle05.SM_vehCar_vehicle05"),
		TEXT("/Game/Vehicle/vehCar_vehicle06/Mesh/SM_vehCar_vehicle06.SM_vehCar_vehicle06"),
		TEXT("/Game/Vehicle/vehVan_vehicle01/Mesh/SM_vehVan_vehicle01.SM_vehVan_vehicle01") };
	const TCHAR* const Unit = TEXT("/Game/BW/Kit/SM_K_Unit.SM_K_Unit");

	bool Inside(const TArray<FVector2D>& R, const FVector2D& P)
	{
		bool In = false;
		for (int32 i = 0, j = R.Num() - 1; i < R.Num(); j = i++)
			if (((R[i].Y > P.Y) != (R[j].Y > P.Y)) && (P.X < (R[j].X - R[i].X) * (P.Y - R[i].Y) / (R[j].Y - R[i].Y) + R[i].X)) In = !In;
		return In;
	}
	constexpr double Cell = 5000;
	FIntPoint CellOf(const FVector2D& P) { return FIntPoint(FMath::FloorToInt(P.X / Cell), FMath::FloorToInt(P.Y / Cell)); }
}

bool FBWHouseBuilder::Available() { return FPackageName::DoesPackageExist(TEXT("/Game/BW/Homes/SM_HK_Ranch")); }

void FBWHouseBuilder::Prepare(const FBWCity& City, const TArray<FBWVolume>& Volumes, double FootZ)
{
	GroundZ = FootZ;
	Streets.Reset();
	Homes.Reset();
	for (const FBWCenterline& C : City.Centerlines)
		for (int32 i = 0; i + 1 < C.Line.Num(); ++i)
		{
			const FVector2D A = C.Line[i], B = C.Line[i + 1];
			FBox2D Bx(ForceInit); Bx += A; Bx += B;
			const FIntPoint C0 = CellOf(Bx.Min), C1 = CellOf(Bx.Max);
			for (int32 x = C0.X; x <= C1.X; ++x) for (int32 y = C0.Y; y <= C1.Y; ++y) Streets.FindOrAdd(FIntPoint(x, y)).Add({ A, B, C.Width });
		}
	for (const FBWVolume& V : Volumes)
	{
		if (V.Deco != TEXT("house") || V.Ring.Num() < 3) continue;
		FVector2D C(0, 0); for (const FVector2D& P : V.Ring) C += P; C /= V.Ring.Num();
		Homes.FindOrAdd(CellOf(C)).Add(V.Ring);
	}
}

bool FBWHouseBuilder::NearestStreet(const FVector2D& P, FVector2D& Q, double& Width) const
{
	double Best = 6000.0 * 6000.0;
	bool bAny = false;
	const FIntPoint C = CellOf(P);
	for (int32 x = -1; x <= 1; ++x) for (int32 y = -1; y <= 1; ++y)
		if (const TArray<FSeg>* L = Streets.Find(C + FIntPoint(x, y)))
			for (const FSeg& S : *L)
			{
				const FVector2D D = S.B - S.A;
				const double T = FMath::Clamp(FVector2D::DotProduct(P - S.A, D) / FMath::Max(1.0, D.SizeSquared()), 0.0, 1.0);
				const FVector2D N = S.A + D * T;
				const double D2 = (N - P).SizeSquared();
				if (D2 < Best) { Best = D2; Q = N; Width = S.W; bAny = true; }
			}
	return bAny;
}

bool FBWHouseBuilder::OnNeighbour(const FVector2D& P, const TArray<FVector2D>& Own) const
{
	const FIntPoint C = CellOf(P);
	for (int32 x = -1; x <= 1; ++x) for (int32 y = -1; y <= 1; ++y)
		if (const TArray<TArray<FVector2D>>* L = Homes.Find(C + FIntPoint(x, y)))
			for (const TArray<FVector2D>& R : *L)
				if (R.Num() && R[0] != Own[0] && Inside(R, P)) return true;
	return false;
}

void FBWHouseBuilder::Dress(const FBWVolume& V, uint32 Seed)
{
	const int32 N = V.Ring.Num();
	if (N < 3) return;
	FVector2D Ctr(0, 0); for (const FVector2D& P : V.Ring) Ctr += P; Ctr /= N;
	// THE FRONT faces the nearest street: the edge whose middle is closest to one
	int32 Fe = 0; double Fd = 1e30;
	FVector2D StreetPt = Ctr; double StreetW = 800; bool bStreet = false;
	for (int32 i = 0; i < N; ++i)
	{
		const FVector2D M = (V.Ring[i] + V.Ring[(i + 1) % N]) * 0.5;
		FVector2D Q; double Wd;
		const double D = NearestStreet(M, Q, Wd) ? (Q - M).Size() : 1e20 - (V.Ring[(i + 1) % N] - V.Ring[i]).Size();
		if (D < Fd) { Fd = D; Fe = i; if (D < 1e19) { StreetPt = Q; StreetW = Wd; bStreet = true; } }
	}
	const FVector2D A0 = V.Ring[Fe], B0 = V.Ring[(Fe + 1) % N];
	FVector2D Out = FVector2D(-(B0 - A0).Y, (B0 - A0).X).GetSafeNormal();
	if (FVector2D::DotProduct(Out, (A0 + B0) * 0.5 - Ctr) < 0) Out = -Out;
	const FVector2D Dir(Out.Y, -Out.X);   // local X: turning it +90 degrees gives Out (the kit's +Y), unmirrored
	double W0 = 1e18, W1 = -1e18, D0 = 1e18, D1 = -1e18;
	for (const FVector2D& P : V.Ring)
	{
		W0 = FMath::Min(W0, FVector2D::DotProduct(P - Ctr, Dir)); W1 = FMath::Max(W1, FVector2D::DotProduct(P - Ctr, Dir));
		D0 = FMath::Min(D0, FVector2D::DotProduct(P - Ctr, Out)); D1 = FMath::Max(D1, FVector2D::DotProduct(P - Ctr, Out));
	}
	const double Wf = W1 - W0, Df = D1 - D0;
	const FVector2D Mid = Ctr + Dir * ((W0 + W1) * 0.5) + Out * ((D0 + D1) * 0.5);
	const double Yaw = FMath::RadiansToDegrees(FMath::Atan2(Dir.Y, Dir.X));

	// THE TYPE: of the era's types, the one whose proportions best fit the lot's footprint (a deep narrow
	// footprint is a bungalow, a long low one a ranch), the deed's hash between near equals
	const TArray<EStyle> Era = EraStyles(V.Year);
	const double Aspect = Wf / FMath::Max(1.0, Df);
	EStyle St = Era[0];
	double Score = 1e9;
	for (int32 k = 0; k < Era.Num(); ++k)
	{
		const FStyle& S = Styles[Era[k]];
		const double Sc = FMath::Abs(FMath::Loge(Aspect / (S.W / S.D))) + 0.12 * k + 0.25 * ((Seed >> (k * 3)) % 4) / 3.0;
		if (Sc < Score) { Score = Sc; St = Era[k]; }
	}
	const FStyle& S = Styles[St];
	const bool bMirror = S.Mirror && (Seed >> 9) % 2;
	const double Sx = FMath::Clamp(Wf / S.W, 0.72, 1.3), Sy = FMath::Clamp(Df / S.D, 0.72, 1.3);
	const FPalette Pal = PaletteOf(V.Year, St);
	const TPair<const TCHAR*, const TCHAR*>& Wall = Pal.Walls[(Seed >> 4) % Pal.Walls.Num()];
	const TCHAR* Roof = Pal.Roofs[(Seed >> 12) % Pal.Roofs.Num()];
	const FBWSlotMat Mats[] = { { TEXT("wall"), Wall.Key }, { TEXT("accent"), Wall.Value }, { TEXT("roof"), Roof } };
	Kit.Add(bMirror ? S.Mirror : S.Mesh, FTransform(FRotator(0, Yaw, 0), FVector(Mid, V.Z0), FVector(Sx, Sy, 1.0)), Mats);
	++Houses;

	// THE DRIVEWAY, from the garage door (or, on an older lot, along the side to a garage out back) to the kerb
	const FBWSlotMat Concrete[] = { { TEXT("wall"), FGM("Concrete", "Concrete") } };
	FRandomStream Rng((int32)Seed);
	auto Local = [&](double X, double Y) { return Mid + Dir * (X * Sx) + Out * (Y * Sy); };
	auto ToKerb = [&](const FVector2D& From) -> double
	{
		if (!bStreet) return 0;
		const double D = FVector2D::DotProduct(StreetPt - From, Out) - StreetW * 0.5;
		return D > 100 && D < 2500 ? D : 0;
	};
	auto Slab = [&](const FVector2D& A, const FVector2D& B, double Width)
	{
		const FVector2D C = (A + B) * 0.5, E = B - A;
		const double L = E.Size();
		if (L < 50) return;
		Kit.Add(Unit, FTransform(FRotator(0, FMath::RadiansToDegrees(FMath::Atan2(E.Y, E.X)), 0), FVector(C, GroundZ - 3), FVector(L / 100.0, Width / 100.0, 0.05)), Concrete);
	};
	if (S.bGarage)
	{
		const double Gx = (bMirror ? -S.GX : S.GX);
		const FVector2D Door = Local(Gx, S.GY);
		const double L = ToKerb(Door);
		if (L > 0)
		{
			const double Width = St == Colonial || St == Farmhouse ? 520 : 330;
			Slab(Door, Door + Out * L, Width);
			// a car or two at home, nose to the garage
			const int32 NCars = Rng.FRand() < 0.55 ? (Width > 400 && Rng.FRand() < 0.4 ? 2 : 1) : 0;
			for (int32 c = 0; c < NCars && L > 600; ++c)
				Kit.Add(Cars[Rng.RandRange(0, UE_ARRAY_COUNT(Cars) - 1)], FTransform(FRotator(0, FMath::RadiansToDegrees(FMath::Atan2(-Out.Y, -Out.X)), 0), FVector(Door + Out * 330 + Dir * (NCars > 1 ? (c ? 130 : -130) : 0), GroundZ - 6)));
		}
	}
	else if (S.bBack)
	{
		// the side drive past the house to a one-car garage at the back corner, when the yard has room
		const double Side = (Seed >> 7) % 2 ? 1.0 : -1.0;
		const double Gx = Side * (Wf * 0.5 + 200);
		const FVector2D Front = Mid + Dir * Gx + Out * (Df * 0.5);
		const FVector2D Gc = Mid + Dir * Gx - Out * (Df * 0.5 + 750);
		const bool bRoom = !OnNeighbour(Front, V.Ring) && !OnNeighbour(Gc, V.Ring) && !OnNeighbour(Gc + Dir * 320, V.Ring) && !OnNeighbour(Gc - Dir * 320, V.Ring)
			&& !OnNeighbour(Gc - Out * 340, V.Ring) && !OnNeighbour(Mid + Dir * Gx, V.Ring);
		const double L = ToKerb(Front);
		if (bRoom && L > 0)
		{
			Kit.Add(HK("SM_HK_Garage"), FTransform(FRotator(0, Yaw, 0), FVector(Gc, V.Z0)), Mats);
			Slab(Gc + Out * 330, Front + Out * L, 280);
			if (Rng.FRand() < 0.4) Kit.Add(Cars[Rng.RandRange(0, UE_ARRAY_COUNT(Cars) - 1)], FTransform(FRotator(0, FMath::RadiansToDegrees(FMath::Atan2(-Out.Y, -Out.X)), 0), FVector(Front - Out * 200, GroundZ - 6)));
		}
		// the front walk from the porch to the sidewalk
		const FVector2D Walk = Mid + Dir * (Wf * 0.5 * -0.17) + Out * (Df * 0.5);
		const double Lw = ToKerb(Walk);
		if (Lw > 0) Slab(Walk, Walk + Out * FMath::Max(0.0, Lw - 300), 110);
	}
}
