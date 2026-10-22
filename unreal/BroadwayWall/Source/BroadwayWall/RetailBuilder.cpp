#include "RetailBuilder.h"
#include "FacadeBuilder.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/TextRenderComponent.h"
#include "Engine/StaticMesh.h"
#include "Materials/MaterialInterface.h"

DEFINE_LOG_CATEGORY_STATIC(LogBWRetail, Log, All);

// ---------------------------------------------------------------- the kit set

void FBWKitSet::Add(const TCHAR* Mesh, const FTransform& T, TArrayView<const FBWSlotMat> Mats)
{
	FString Key = Mesh;
	for (const FBWSlotMat& M : Mats) { Key += TEXT("|"); Key += M.Slot; Key += TEXT("="); Key += M.Path; }
	UInstancedStaticMeshComponent* C = Comps.FindRef(Key);
	if (!C)
	{
		if (Comps.Contains(Key)) return;   // a mesh that failed to load: noted once
		UStaticMesh* SM = LoadObject<UStaticMesh>(nullptr, Mesh);
		if (!SM) { UE_LOG(LogBWRetail, Warning, TEXT("kit mesh missing: %s (run unreal/tools/make-kit.py)"), Mesh); Comps.Add(Key, nullptr); return; }
		C = NewObject<UInstancedStaticMeshComponent>(Parent->GetOwner());
		C->SetupAttachment(Parent);
		C->SetStaticMesh(SM);
		C->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		for (const FBWSlotMat& M : Mats)
			if (UMaterialInterface* Mi = LoadObject<UMaterialInterface>(nullptr, M.Path)) C->SetMaterialByName(FName(M.Slot), Mi);
			else UE_LOG(LogBWRetail, Warning, TEXT("kit material missing: %s"), M.Path);
		C->RegisterComponent();
		Comps.Add(Key, C);
	}
	const int32 I = C->AddInstance(T);
	++Placed;
	if (Record) Record->Add({ C, I });
}

void FBWKitSet::Text(const FString& Str, const FVector& At, const FVector2D& Facing, double Height, double Width, const FColor& Col, bool bGlow)
{
	if (Str.IsEmpty() || Height < 5) return;
	UTextRenderComponent* T = NewObject<UTextRenderComponent>(Parent->GetOwner());
	T->SetupAttachment(Parent);
	T->SetHorizontalAlignment(EHTA_Center);
	T->SetVerticalAlignment(EVRTA_TextCenter);
	// a Roboto capital is about 0.62 of its size wide: shrink to fit the field
	const double Size = FMath::Min(Height, Width / FMath::Max(1.0, Str.Len() * 0.62));
	T->SetWorldSize(Size);
	T->SetText(FText::FromString(Str));
	T->SetTextRenderColor(Col);
	T->SetCastShadow(false);
	T->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	T->SetWorldLocationAndRotation(At, FRotator(0, FMath::RadiansToDegrees(FMath::Atan2(Facing.Y, Facing.X)), 0));
	T->RegisterComponent();
	Texts.Add(T);
	if (Extra) Extra->Add(T);
}

void FBWKitSet::Reset()
{
	for (TPair<FString, UInstancedStaticMeshComponent*>& P : Comps) if (P.Value) P.Value->ClearInstances();
	for (TWeakObjectPtr<UTextRenderComponent>& T : Texts) if (T.IsValid()) T->DestroyComponent();
	Texts.Reset();
	Placed = 0;
}

// ---------------------------------------------------------------- the retail grammar

namespace
{
#define RK(n) TEXT("/Game/BW/Retail/Mats/MI_RK_" n ".MI_RK_" n)
#define FGM(folder, n) TEXT("/Game/Building/Material/MI/" folder "/ForGym/MI_Bldg_" n "_FG.MI_Bldg_" n "_FG")
#define KITM(n) TEXT("/Game/BW/Kit/" n "." n)
#define RETM(n) TEXT("/Game/BW/Retail/" n "." n)

	// THE BODY'S MATERIALS (the solids the city builder meshes): renders, masonry, roofs
	enum ESolid { SEifsTan, SEifsSand, SEifsWhite, SEifsGrey, SEifsTerracotta, SEifsSage, SBrickBuff, SBrickRed, SBrickBrown, SBlock, SMembrane, SGravel, SConcrete, SBrandRed, SBrandYellow, SBrandBlue, SBrandGreen, SBronze, NumSolid };
	const TCHAR* const SolidPaths[NumSolid] = {
		RK("EifsTan"), RK("EifsSand"), RK("EifsWhite"), RK("EifsGrey"), RK("EifsTerracotta"), RK("EifsSage"),
		FGM("Brick", "BrickOffset_Yellow"), FGM("Brick", "BrickOffset_Red"), FGM("Brick", "BrickOffset_Brown"), FGM("Block", "Block_Limestone_Grey"),
		RK("Membrane"), TEXT("/Game/Environment/RoofTop/Material/MI/MI_Rooftop_PebbleDash.MI_Rooftop_PebbleDash"), FGM("Concrete", "Concrete"),
		RK("BrandRed"), RK("BrandYellow"), RK("BrandBlue"), RK("BrandGreen"), RK("Bronze") };
	// the same, for a kit slot
	const TCHAR* SolidPath(int32 S) { return SolidPaths[FMath::Clamp(S, 0, NumSolid - 1)]; }

	const TCHAR* const Awnings[] = { RK("AwningRed"), RK("AwningGreen"), RK("AwningNavy"), RK("AwningBurgundy"), RK("AwningTan"), RK("AwningTeal") };
	const TCHAR* const MetalRoofs[] = { FGM("Paint", "PaintedMetal_Green"), FGM("Paint", "PaintedMetal_Red"), RK("RoofBlue"), RK("RoofCharcoal") };
	const TCHAR* const Glows[] = { RK("GlowWhite"), RK("GlowRed"), RK("GlowBlue"), RK("GlowYellow"), RK("GlowGreen"), RK("GlowOrange") };
	const FColor Letters[] = { FColor(196, 20, 18), FColor(20, 52, 150), FColor(250, 250, 245), FColor(18, 110, 40), FColor(240, 170, 10), FColor(30, 30, 32), FColor(200, 80, 10) };
	const TCHAR* const Cars[] = {
		TEXT("/Game/Vehicle/vehCar_vehicle02/Mesh/SM_vehCar_vehicle02.SM_vehCar_vehicle02"),
		TEXT("/Game/Vehicle/vehCar_vehicle03/Mesh/SM_vehCar_vehicle03.SM_vehCar_vehicle03"),
		TEXT("/Game/Vehicle/vehCar_vehicle05/Mesh/SM_vehCar_vehicle05.SM_vehCar_vehicle05"),
		TEXT("/Game/Vehicle/vehCar_vehicle06/Mesh/SM_vehCar_vehicle06.SM_vehCar_vehicle06"),
		TEXT("/Game/Vehicle/vehCar_vehicle07/Mesh/SM_vehCar_vehicle07.SM_vehCar_vehicle07") };
	const TCHAR* const RoofUnit = TEXT("/Game/Prop/Kit_roof_AC_Unit_B/Mesh/SM_roof_AC_Unit_B_01_N1.SM_roof_AC_Unit_B_01_N1");
	const TCHAR* const RoofVent = TEXT("/Game/Prop/Kit_Roof_Vent_RR/Mesh/SM_RooftopVent_N1.SM_RooftopVent_N1");
	const TCHAR* const Dumpster = TEXT("/Game/BW/Yard/SM_Dumpster.SM_Dumpster");

	// THE TENANTS. Invented names, the trades a real centre leases to: never a real brand.
	const TCHAR* const Inline[] = { TEXT("NAILS"), TEXT("PIZZA"), TEXT("SUBS"), TEXT("CLEANERS"), TEXT("TAX SERVICE"), TEXT("CELL PHONES"), TEXT("CHINA GARDEN"),
		TEXT("TAQUERIA"), TEXT("BEAUTY SUPPLY"), TEXT("FITNESS"), TEXT("PET GROOMING"), TEXT("DENTAL"), TEXT("MATTRESS"), TEXT("LIQUOR"), TEXT("DONUTS"),
		TEXT("INSURANCE"), TEXT("BARBER"), TEXT("THRIFT"), TEXT("HAIR SALON"), TEXT("OPTICAL"), TEXT("LOANS"), TEXT("LAUNDROMAT"), TEXT("KARATE"),
		TEXT("FLOWERS"), TEXT("SHOE REPAIR"), TEXT("VITAMINS"), TEXT("TANNING"), TEXT("CHIROPRACTIC"), TEXT("CARDS & GIFTS"), TEXT("SUSHI"), TEXT("BAGELS"),
		TEXT("WIRELESS"), TEXT("STAFFING"), TEXT("REALTY"), TEXT("PHO"), TEXT("SMOOTHIES"), TEXT("DOLLAR STORE"), TEXT("VIDEO GAMES"), TEXT("TATTOO") };
	const TCHAR* const Grocers[] = { TEXT("HARVEST FOODS"), TEXT("VALLEY FRESH"), TEXT("FOOD FAIR"), TEXT("GREENLEAF MARKET"), TEXT("PRAIRIE FOODS"), TEXT("HOMETOWN MARKET") };
	const TCHAR* const Boxes[] = { TEXT("HOME & HARDWARE"), TEXT("SPORTS ZONE"), TEXT("PET DEPOT"), TEXT("BOOK BARN"), TEXT("FURNITURE GALLERY"), TEXT("ELECTRONICS PLUS"),
		TEXT("CRAFT WORLD"), TEXT("DISCOUNT CITY"), TEXT("OFFICE WORKS"), TEXT("BED & BATH"), TEXT("FARM & FLEET"), TEXT("TOY TOWN") };
	const TCHAR* const Depts[] = { TEXT("BRANDT'S"), TEXT("HOLLIS & CO."), TEXT("MERCER'S"), TEXT("THE BON TON SHOP") };
	const TCHAR* const Qsrs[] = { TEXT("BURGER BARN"), TEXT("TACO VILLA"), TEXT("CHICKEN SHACK"), TEXT("ROAST BEEF"), TEXT("FROSTY'S") };
	const TCHAR* const Banks[] = { TEXT("FIRST STATE BANK"), TEXT("FARMERS BANK"), TEXT("COUNTY SAVINGS"), TEXT("CITIZENS NATIONAL") };
	const TCHAR* const Diners[] = { TEXT("FAMILY RESTAURANT"), TEXT("STEAKHOUSE"), TEXT("PANCAKE HOUSE"), TEXT("BAR & GRILL") };
	const TCHAR* const Fuels[] = { TEXT("QUIK STOP"), TEXT("FUEL MART"), TEXT("GAS N GO"), TEXT("PETRO PLUS") };

	template <typename T, int32 N> const T& Pick(const T (&A)[N], uint32 H) { return A[H % N]; }
	uint32 Mix(uint32 H, uint32 K) { return HashCombine(H, K * 0x9e3779b9u + 0x7f4a7c15u); }

	/** One face of the footprint: X along it (Dir), Y out of it (Out), from its corner A; L its length, D the depth behind it. */
	struct FFace
	{
		FVector2D A, Dir, Out;
		double L = 0, D = 0, Z0 = 0, Yaw = 0;
		FVector2D P(double S, double O) const { return A + Dir * S + Out * O; }
		FVector At(double S, double O, double Z) const { return FVector(P(S, O), Z0 + Z); }
		FTransform T(double S, double O, double Z, const FVector& Scale = FVector(1), double Turn = 0) const
		{ return FTransform(FRotator(0, Yaw + Turn, 0), At(S, O, Z), Scale); }
		/** A rectangle in this face's frame (s0..s1 along, o0..o1 out), as a ring. */
		TArray<FVector2D> Rect(double S0, double S1, double O0, double O1) const { return { P(S0, O0), P(S1, O0), P(S1, O1), P(S0, O1) }; }
	};
	FVector2D Centroid(const TArray<FVector2D>& R) { FVector2D C(0, 0); for (const FVector2D& P : R) C += P; return R.Num() ? C / R.Num() : C; }
	FFace FaceOf(const FBWVolume& V, int32 E)
	{
		const int32 N = V.Ring.Num();
		const FVector2D A0 = V.Ring[E % N], B0 = V.Ring[(E + 1) % N], C = Centroid(V.Ring);
		FFace F;
		F.L = (B0 - A0).Size();
		FVector2D Nn = FVector2D(-(B0 - A0).Y, (B0 - A0).X).GetSafeNormal();
		if (FVector2D::DotProduct(Nn, (A0 + B0) * 0.5 - C) < 0) Nn = -Nn;
		F.Out = Nn;
		// local X turns into local Y by +90 degrees of yaw: X = (Out.Y, -Out.X) keeps the kit unmirrored
		F.Dir = FVector2D(Nn.Y, -Nn.X);
		F.A = FVector2D::DotProduct(B0 - A0, F.Dir) >= 0 ? A0 : B0;
		for (const FVector2D& Q : V.Ring) F.D = FMath::Max(F.D, FVector2D::DotProduct(F.A - Q, F.Out));
		F.Z0 = V.Z0;
		F.Yaw = FMath::RadiansToDegrees(FMath::Atan2(F.Dir.Y, F.Dir.X));
		return F;
	}
	/** The storefront's edge: the one whose middle is nearest the generator's front point (the longest, if none). */
	int32 FrontEdge(const FBWVolume& V)
	{
		const int32 N = V.Ring.Num();
		int32 Best = 0; double Bd = 1e30;
		for (int32 i = 0; i < N; ++i)
		{
			const FVector2D M = (V.Ring[i] + V.Ring[(i + 1) % N]) * 0.5;
			const double D = V.bFront ? (M - V.Front).SizeSquared() : -(V.Ring[(i + 1) % N] - V.Ring[i]).SizeSquared();
			if (D < Bd) { Bd = D; Best = i; }
		}
		return Best;
	}

	/** A centre's look: its era picks the materials, its deed varies them. */
	struct FScheme
	{
		int32 Body = SEifsTan, Band = SEifsSand, Base = SBlock;
		const TCHAR* Pier = RK("EifsSand");
		const TCHAR* Awning = nullptr;     // fabric awnings; null: flat metal canopies
		const TCHAR* Roof = nullptr;       // the tower's metal roof; null: a flat tower
		bool bMixedAwnings = false;
		int32 Brand = SBrandRed;
	};
	FScheme SchemeOf(const FBWVolume& V, uint32 H)
	{
		FScheme S;
		const int32 Y = V.Year > 0 ? V.Year : 1990;
		if (Y < 1980)
		{
			// the 1960s-70s strip: brick piers and a plain render fascia, awnings added later in reds and greens
			static const int32 Bodies[] = { SBrickBuff, SBrickRed, SBrickBrown };
			static const TCHAR* const Piers[] = { FGM("Brick", "BrickOffset_Yellow"), FGM("Brick", "BrickOffset_Red"), FGM("Brick", "BrickOffset_Brown") };
			const int32 k = H % 3;
			S.Body = SBlock; S.Base = Bodies[k]; S.Pier = Piers[k];
			S.Band = (H >> 4) % 2 ? SEifsWhite : SEifsSand;
			S.Awning = (H >> 6) % 4 == 0 ? nullptr : Pick(Awnings, H >> 8);
			S.bMixedAwnings = (H >> 11) % 2 == 0;
			S.Roof = (H >> 13) % 3 == 0 ? Pick(MetalRoofs, H >> 15) : nullptr;
		}
		else if (Y < 2000)
		{
			// the 1980s-90s centre: tan and sand render, buff brick or render piers, a hip-roofed tower, one awning colour
			static const int32 Bands[] = { SEifsTan, SEifsSand, SEifsWhite };
			S.Body = SEifsGrey; S.Band = Bands[H % 3]; S.Base = (H >> 3) % 2 ? SBrickBuff : SBlock;
			S.Pier = (H >> 5) % 2 ? FGM("Brick", "BrickOffset_Yellow") : RK("EifsTan");
			S.Awning = (H >> 7) % 5 == 0 ? nullptr : Pick(Awnings, H >> 9);
			S.Roof = (H >> 12) % 4 == 0 ? nullptr : Pick(MetalRoofs, H >> 14);
		}
		else
		{
			// the 2000s lifestyle strip: render in two or three earth tones, stone-coloured piers, flat towers, metal canopies
			static const int32 Bands[] = { SEifsSand, SEifsTerracotta, SEifsSage, SEifsWhite };
			S.Body = SEifsGrey; S.Band = Bands[H % 4]; S.Base = SBrickBrown;
			S.Pier = (H >> 4) % 2 ? FGM("Block", "Block_Limestone_Beige") : RK("EifsTan");
			S.Awning = (H >> 6) % 3 == 0 ? Pick(Awnings, H >> 8) : nullptr;
			S.Roof = (H >> 10) % 4 == 0 ? Pick(MetalRoofs, H >> 12) : nullptr;
		}
		if (V.Role == TEXT("box"))
		{
			// a big box wears its chain's colours, not the centre's: a body and a contrasting portal
			static const int32 Bodies[] = { SEifsGrey, SEifsTan, SBlock, SEifsWhite, SEifsSand, SEifsSage };
			static const int32 Accents[] = { SEifsTerracotta, SEifsWhite, SBrandRed, SEifsTan, SBrandBlue };
			S.Body = Bodies[H % 6];
			S.Band = Accents[(H >> 5) % 5];
			if (S.Band == S.Body) S.Band = SEifsTerracotta;
		}
		static const int32 Brands[] = { SBrandRed, SBrandYellow, SBrandBlue, SBrandGreen };
		S.Brand = Brands[(H >> 17) % 4];
		return S;
	}

	/** An inline building's shops: bays between piers, grouped into tenants, the towers among them. */
	struct FBay { double S0, S1; int32 Tenant; };
	struct FTenant { double S0, S1; int32 Raise; bool bVacant; uint32 H; };
	struct FInline
	{
		TArray<double> Towers;     // tower centres along the front
		TArray<FBay> Bays;
		TArray<FTenant> Tenants;
	};
	constexpr double TowerW = 900;
	FInline PlanInline(const FFace& F, uint32 H, bool bTowers)
	{
		FInline P;
		const double L = F.L;
		if (bTowers && L >= 3000)
		{
			const bool bLeft = H % 2 == 0;
			P.Towers.Add(bLeft ? TowerW * 0.5 : L - TowerW * 0.5);
			if (L >= 8000) P.Towers.Add(bLeft ? L - TowerW * 0.5 : TowerW * 0.5);
			if (L >= 12000) P.Towers.Add(L * (0.45 + 0.1 * ((H >> 3) % 2)));
			P.Towers.Sort();
		}
		// the runs of shops between the towers
		TArray<TPair<double, double>> Runs;
		double S = 0;
		for (const double T : P.Towers) { if (T - TowerW * 0.5 - S > 300) Runs.Add({ S, T - TowerW * 0.5 }); S = T + TowerW * 0.5; }
		if (L - S > 300) Runs.Add({ S, L });
		uint32 R = Mix(H, 77);
		int32 Left = 0;
		for (const TPair<double, double>& Run : Runs)
		{
			const int32 N = FMath::Max(1, FMath::RoundToInt((Run.Value - Run.Key) / 700.0));
			const double W = (Run.Value - Run.Key) / N;
			for (int32 k = 0; k < N; ++k)
			{
				if (Left == 0)
				{
					// a new tenant: one to three bays, two the commonest (a 1,200-1,500 sf shop)
					R = Mix(R, k + 1);
					const int32 Sz = (R % 10) < 3 ? 1 : (R % 10) < 8 ? 2 : 3;
					Left = FMath::Min(Sz, N - k);
					FTenant& T = P.Tenants.AddDefaulted_GetRef();
					T.S0 = Run.Key + k * W; T.S1 = T.S0;
					T.H = R;
					static const int32 Raises[] = { 0, 0, 90, 150, 0, 60 };
					T.Raise = Raises[(R >> 5) % 6];
					T.bVacant = (R >> 9) % 11 == 0;
				}
				P.Bays.Add({ Run.Key + k * W, Run.Key + (k + 1) * W, P.Tenants.Num() - 1 });
				P.Tenants.Last().S1 = Run.Key + (k + 1) * W;
				--Left;
			}
			Left = 0;   // a tower ends a tenant
		}
		return P;
	}

	bool IsAnchor(const FString& R) { return R == TEXT("grocery") || R == TEXT("box") || R == TEXT("dept") || R == TEXT("mall"); }
	bool IsPad(const FString& R) { return R == TEXT("qsr") || R == TEXT("bank") || R == TEXT("gas") || R == TEXT("truckstop") || R == TEXT("restaurant") || R == TEXT("general"); }
}

int32 FBWRetailBuilder::NumMats() { return NumSolid; }
const TCHAR* FBWRetailBuilder::MatPath(int32 Mat) { return SolidPath(Mat); }

void FBWRetailBuilder::Mass(const FBWVolume& V, TArray<FBWSolid>& Solids) const
{
	if (V.Ring.Num() < 3) return;
	// (an anchor is its own tenant: its own colours, as Dress picks them)
	const uint32 H = IsAnchor(V.Role) ? HashCombine(GetTypeHash(V.Bbl), GetTypeHash(FMath::RoundToInt(V.Ring[0].X)) ^ GetTypeHash(FMath::RoundToInt(V.Ring[0].Y))) : GetTypeHash(V.Bbl);
	const FScheme S = SchemeOf(V, H);
	auto Solid = [&](int32 Mat, TArray<FVector2D> Ring, double Z0, double Z1, bool bTop = true)
	{ FBWSolid& O = Solids.AddDefaulted_GetRef(); O.Mat = Mat; O.Ring = MoveTemp(Ring); O.Z0 = Z0; O.Z1 = Z1; O.bTop = bTop; };
	if (V.Role == TEXT("pylon")) return;   // all kit
	const FFace F = FaceOf(V, FrontEdge(V));
	const bool bOld = V.Year > 0 && V.Year < 1975;
	// the body: its own walls (rear and sides in block or render), a membrane or gravel roof
	const int32 Body = IsPad(V.Role) ? (V.Role == TEXT("bank") || V.Role == TEXT("general") ? S.Base : S.Band) : IsAnchor(V.Role) ? (V.Role == TEXT("box") ? S.Body : S.Band) : S.Body;
	Solid(Body, V.Ring, V.Z0, V.Z1, false);
	Solid(bOld ? SGravel : SMembrane, V.Ring, V.Z1 - 1, V.Z1);
	// the front's own face: the sign band in render over the storefronts (inline), the anchor's wall
	if (V.Role == TEXT("inline") || V.Role == TEXT("restaurant"))
	{
		const FInline P = PlanInline(F, H, V.Role == TEXT("inline"));
		// THE PARAPET STEPS with the tenants (a strip's roofline is never one line): the band rises over some shops
		for (const FTenant& T : P.Tenants)
			Solid(S.Band, F.Rect(T.S0, T.S1, -45, 6), V.Z0 + 330, V.Z1 + T.Raise);
		// the base under the storefronts' sills, in brick or block
		Solid(S.Base, F.Rect(0, F.L, -10, 4), V.Z0, V.Z0 + 35);
	}
	else if (IsAnchor(V.Role))
	{
		// a split-face or brick wainscot and the parapet band, 1.2 m above the roof
		Solid(S.Base, F.Rect(0, F.L, -10, 8), V.Z0, V.Z0 + 120);
		Solid(Body == S.Band ? S.Body : S.Band, F.Rect(0, F.L, -45, 6), V.Z1 - 260, V.Z1 + 120);
	}
	else if (V.Role == TEXT("qsr") || V.Role == TEXT("gas") || V.Role == TEXT("truckstop"))
	{
		// THE BRAND BAND: the pad's colour round its whole top, the way a chain dresses its box
		// (walls only: a top would paint the whole roof the brand's colour)
		const TArray<FVector2D> Out = BWInsetRing(V.Ring, -12);
		Solid(S.Brand, Out, V.Z1 - 150, V.Z1 + 2, false);
		Solid(S.Base, F.Rect(0, F.L, -10, 6), V.Z0, V.Z0 + 60);
	}
	else if (V.Role == TEXT("general"))
	{
		// the old general store's false front: the parapet squared up above the roof across the front
		Solid(S.Base, F.Rect(-10, F.L + 10, -30, 4), V.Z0, V.Z1 + 160);
	}
	else if (V.Role == TEXT("bank"))
	{
		Solid(SEifsWhite, BWInsetRing(V.Ring, -10), V.Z1 - 60, V.Z1, false);   // the cornice band under the roof
	}
}

void FBWRetailBuilder::Dress(const FBWVolume& V, const FString& Name)
{
	if (V.Ring.Num() < 3) return;
	uint32 H = GetTypeHash(V.Bbl);
	const uint32 Hv = HashCombine(H, GetTypeHash(FMath::RoundToInt(V.Ring[0].X)) ^ GetTypeHash(FMath::RoundToInt(V.Ring[0].Y)));
	FScheme S = SchemeOf(V, H);
	const double Ht = V.Z1 - V.Z0;
	constexpr double G = 16;   // the ground's top (the lot and the sidewalk), cm above the volume's base
	FBWKitSet& K = Kit;
	auto Mats = [](std::initializer_list<FBWSlotMat> L) { return TArray<FBWSlotMat>(L); };

	// ---------------------------------------------------------------- THE PYLON SIGN
	if (V.Role == TEXT("pylon"))
	{
		// the column stands across the road's line of sight: its faces look up and down the road
		const FVector2D C = Centroid(V.Ring);
		const FVector2D Road = V.bFront ? (V.Front - C).GetSafeNormal() : FVector2D(1, 0);
		const FVector2D Face(-Road.Y, Road.X);
		const double Sc = FMath::Clamp(Ht / 900.0, 0.8, 1.4);
		const double Yaw = FMath::RadiansToDegrees(FMath::Atan2(Road.Y, Road.X));
		K.Add(RETM("SM_RK_Pylon"), FTransform(FRotator(0, Yaw, 0), FVector(C, V.Z0), FVector(1, 1, Sc)), Mats({ { TEXT("wall"), SolidPath(S.Band) }, { TEXT("trim"), SolidPath(S.Base) } }));
		// the tenant panels down both faces, the anchors first and biggest, and the centre's name in the cap
		const int32 N = FMath::Clamp(V.Panels, 2, 8);
		const double Z0 = 160 * Sc, Z1 = 880 * Sc, Ph = (Z1 - Z0) / N;
		FString Centre = Name;
		int32 Cut; if (Centre.FindChar(TEXT('('), Cut)) Centre = Centre.Left(Cut).TrimEnd();
		Centre = Centre.ToUpper();
		for (int32 Side = -1; Side <= 1; Side += 2)
		{
			const FVector2D Fo = Face * Side;
			const double SideYaw = FMath::RadiansToDegrees(FMath::Atan2(Fo.Y, Fo.X)) - 90;   // the panel's +Y out of this face
			for (int32 i = 0; i < N; ++i)
			{
				const uint32 Hp = Mix(H, 31 + i);
				const double Zb = Z1 - (i + 1) * Ph + 6;
				const bool bAnchor = i < 2;
				K.Add(RETM("SM_RK_SignBox"), FTransform(FRotator(0, SideYaw, 0), FVector(C + Fo * 45, V.Z0 + Zb), FVector(2.8, 1, (Ph - 12) / 100.0)),
					Mats({ { TEXT("accent"), bAnchor ? Pick(Glows, Hp) : RK("GlowWhite") } }));
				const FString Str = i == 0 ? Pick(Grocers, Hp) : i == 1 ? Pick(Boxes, Hp) : Pick(Inline, Hp);
				K.Text(Str, FVector(C + Fo * 70, V.Z0 + Zb + (Ph - 12) * 0.5), Fo, (Ph - 12) * 0.55, 250, bAnchor ? FColor(250, 250, 250) : Pick(Letters, Hp >> 3));
			}
			K.Text(Centre, FVector(C + Fo * 62, V.Z0 + 905 * Sc), Fo, 22 * Sc, 320 * Sc, FColor(40, 40, 44));
		}
		return;
	}

	const FFace F = FaceOf(V, FrontEdge(V));
	const int32 Fe = FrontEdge(V);
	const FFace B = FaceOf(V, Fe + 2);                        // the back
	const FFace Sd = FaceOf(V, Fe + ((Hv >> 2) % 2 ? 1 : 3)); // a side (the drive-through's, the teller canopy's)
	FRandomStream Rng((int32)Hv);
	const FVector2D Ctr = Centroid(V.Ring);

	// ROOF PLANT: packaged rooftop units, one per 250-450 m2 below, on rails in rows along the roof
	auto RoofPlant = [&](double PerM2, int32 Max, double Big = 1.0)
	{
		const double Area = F.L * F.D / 1.0e4;
		const int32 Units = FMath::Clamp(int32(Area / PerM2) + 1, 1, Max);
		const int32 Per = FMath::Clamp(int32(F.L / 1800) + 1, 1, 8);
		const int32 Rows = (Units + Per - 1) / Per;
		for (int32 u = 0; u < Units; ++u)
		{
			const int32 r = u / Per, c = u % Per;
			const double Sx = F.L * (c + 0.5) / Per + Rng.FRandRange(-150, 150);
			const double Oy = -F.D * (r + 1.0) / (Rows + 1) + Rng.FRandRange(-100, 100);
			K.Add(RoofUnit, F.T(Sx, Oy, Ht, FVector(Big), Rng.RandRange(0, 1) * 180.0));
			if (Rng.FRand() < 0.5) K.Add(RoofVent, F.T(Sx + 350, Oy, Ht));
		}
	};
	// A SHOP'S BACK DOOR: a hollow-metal door every tenant, its condenser, a dumpster pen every few
	auto BackDoors = [&](int32 N)
	{
		for (int32 i = 0; i < N; ++i)
		{
			const double Sx = B.L * (i + 0.5) / N;
			K.Add(KITM("SM_K_ManDoor"), B.T(Sx, 0, 0));
			K.Add(KITM("SM_K_Condenser"), B.T(Sx + 220, 75, G));
			if (i % 3 == 1) K.Add(Dumpster, B.T(Sx - 260, 260, G, FVector(1), 90));
		}
	};

	// ---------------------------------------------------------------- INLINE SHOPS (and a sit-down restaurant's front)
	if (V.Role == TEXT("inline") || V.Role == TEXT("restaurant"))
	{
		const FInline P = PlanInline(F, H, V.Role == TEXT("inline"));
		const TArray<FBWSlotMat> PierM = Mats({ { TEXT("wall"), S.Pier } });
		// piers at every bay line (a tower stands in for the ones it covers)
		TSet<int32> Done;
		for (const FBay& Bay : P.Bays)
			for (const double Sx : { Bay.S0, Bay.S1 })
			{
				const int32 Key = FMath::RoundToInt(Sx);
				if (Done.Contains(Key)) continue;
				// a pier between shops (and at the run's ends); within a shop its bays meet at a mullion
				const bool bEdge = P.Tenants.ContainsByPredicate([&](const FTenant& T) { return FMath::Abs(T.S0 - Sx) < 1 || FMath::Abs(T.S1 - Sx) < 1; });
				if (!bEdge) continue;
				Done.Add(Key);
				const int32 Ti = Bay.Tenant;
				double Top = Ht + 20;
				// a pier rides up to the higher of the parapets either side
				for (const FTenant& T : P.Tenants) if (Sx >= T.S0 - 1 && Sx <= T.S1 + 1) Top = FMath::Max(Top, Ht + T.Raise + 20);
				K.Add(RETM("SM_RK_Pier"), F.T(FMath::Clamp(Sx, 35.0, F.L - 35.0), 0, 0, FVector(1, 1, Top / 650.0)), PierM);
			}
		for (const FBay& Bay : P.Bays)
		{
			const FTenant& T = P.Tenants[Bay.Tenant];
			const double W = Bay.S1 - Bay.S0, Mid = (Bay.S0 + Bay.S1) * 0.5;
			K.Add(RETM("SM_RK_Storefront"), F.T(Mid, 14, 0, FVector((W - 70) / 600.0, 1, 1)));
			// the awning: the centre's colour, or each shop its own on an older strip; vacant shops lose theirs
			if (T.bVacant) continue;
			if (S.Awning)
			{
				const TCHAR* Fab = S.bMixedAwnings ? Pick(Awnings, T.H >> 3) : S.Awning;
				K.Add(RETM("SM_RK_Awning"), F.T(Mid, 18, 0, FVector((W - 80) / 600.0, 1, 1)), Mats({ { TEXT("fabric"), Fab } }));
			}
			else K.Add(RETM("SM_RK_Canopy"), F.T(Mid, 18, 0, FVector((W - 80) / 600.0, 1, 1)));
		}
		// THE SIGNS: each shop's name in channel letters on a raceway centred over it, or a lit cabinet
		const TCHAR* const* Names = V.Role == TEXT("restaurant") ? Diners : Inline;
		const int32 NNames = V.Role == TEXT("restaurant") ? UE_ARRAY_COUNT(Diners) : UE_ARRAY_COUNT(Inline);
		for (int32 ti = 0; ti < P.Tenants.Num(); ++ti)
		{
			const FTenant& T = P.Tenants[ti];
			const double Span = T.S1 - T.S0, Mid = (T.S0 + T.S1) * 0.5;
			const double Zt = Ht + T.Raise;           // the band's top over this shop
			const double Zs = (390 + Zt) * 0.5;       // the sign's middle
			const double Sh = FMath::Clamp(Zt - 470, 70.0, 150.0);
			if (T.bVacant)
			{
				K.Text(TEXT("FOR LEASE"), F.At(Mid, 20, 200), F.Out, 28, Span * 0.5, FColor(170, 20, 20));
				continue;
			}
			const FString Str = Names[(T.H >> 7) % NNames];
			FColor Col = Pick(Letters, T.H >> 12);
			if (Col == FColor(30, 30, 32)) Col = FColor(250, 250, 245);   // (dark letters vanish on a bronze raceway)
			const double Sw = FMath::Min(Span * 0.72, Str.Len() * Sh * 0.62 + 80);
			if ((T.H >> 15) % 4 == 0)
			{
				// a cabinet: a lit box with the letters on its face
				K.Add(RETM("SM_RK_SignBox"), F.T(Mid, 6, Zs - Sh * 0.5, FVector(Sw / 100.0, 1, Sh / 100.0)), Mats({ { TEXT("accent"), RK("GlowWhite") } }));
				K.Text(Str, F.At(Mid, 30, Zs), F.Out, Sh * 0.62, Sw - 30, Col == FColor(250, 250, 245) ? FColor(196, 20, 18) : Col);
			}
			else
			{
				K.Add(RETM("SM_RK_Raceway"), F.T(Mid, 6, Zs - 18, FVector(Sw / 100.0, 1, 0.36)));
				K.Text(Str, F.At(Mid, 22, Zs + 4), F.Out, Sh * 0.8, Sw, Col);
			}
			// the coping along this shop's parapet
			K.Add(RETM("SM_RK_Coping"), F.T(Mid, 0, Zt, FVector(Span / 100.0, 1, 1)));
			// a blade of window lettering: hours, "OPEN"
			if ((T.H >> 19) % 3 == 0) K.Text(TEXT("OPEN"), F.At(T.S0 + 120, 22, 190), F.Out, 22, 80, FColor(230, 30, 30));
		}
		// THE TOWERS: the entry or corner tower, its hip roof in the centre's metal, or flat
		for (const double Tc : P.Towers)
		{
			const TArray<FBWSlotMat> TM = S.Roof ? Mats({ { TEXT("wall"), SolidPath(S.Band) }, { TEXT("roof"), S.Roof } }) : Mats({ { TEXT("wall"), SolidPath(S.Band) } });
			const double Tz = FMath::Max(1.0, (Ht + 330) / 1050.0);
			K.Add(S.Roof ? RETM("SM_RK_Tower") : RETM("SM_RK_TowerFlat"), F.T(Tc, 0, 0, FVector(1, 1, Tz)), TM);
			// the centre's or anchor tenant's name on its head
			const uint32 Ht2 = Mix(H, FMath::RoundToInt(Tc));
			K.Text(Pick(Inline, Ht2), F.At(Tc, 262, 900 * Tz), F.Out, 70, 560, Pick(Letters, Ht2 >> 5));
		}
		if (V.Role == TEXT("restaurant"))
		{
			// a sit-down restaurant's entry: a tower over its door, the name big across it
			const TArray<FBWSlotMat> TM = Mats({ { TEXT("wall"), SolidPath(S.Band) }, { TEXT("roof"), S.Roof ? S.Roof : MetalRoofs[0] } });
			K.Add(RETM("SM_RK_Tower"), F.T(F.L * 0.5, 0, 0, FVector(0.8, 0.8, FMath::Max(0.8, (Ht + 250) / 1050.0))), TM);
			K.Text(Pick(Diners, H >> 3), F.At(F.L * 0.5, 210, 760), F.Out, 70, 520, FColor(180, 20, 18));
		}
		BackDoors(FMath::Max(1, P.Tenants.Num()));
		RoofPlant(260, 30);
		return;
	}

	// ---------------------------------------------------------------- ANCHORS: grocery, big box, department store
	if (IsAnchor(V.Role))
	{
		// (a power centre's boxes share a deed: each is its own tenant, so its own name and colours)
		H = Hv;
		S = SchemeOf(V, Hv);
		const bool bGrocery = V.Role == TEXT("grocery");
		const double Se = F.L * (bGrocery ? (0.38 + 0.24 * ((H >> 4) % 2)) : 0.5);
		const double Ez = (Ht + 450) / 1250.0;
		// clear-anodised framing at the doors, the canopy's fascia in the store's colour
		const TArray<FBWSlotMat> EM = Mats({ { TEXT("wall"), SolidPath(S.Band == SEifsGrey ? SEifsSand : S.Band) }, { TEXT("trim"), SolidPath(SEifsWhite) },
			{ TEXT("metal"), FGM("Metal", "Metal_Brushed") }, { TEXT("accent"), SolidPath(bGrocery ? SBrandGreen : S.Brand) } });
		K.Add(RETM("SM_RK_Entry"), F.T(Se, 0, 0, FVector(1, 1, Ez)), EM);
		// the name, big, across the portal's head
		const FString Str = bGrocery ? Pick(Grocers, H >> 6) : V.Role == TEXT("dept") ? Pick(Depts, H >> 6) : V.Role == TEXT("mall") ? (Name.IsEmpty() ? FString(TEXT("MALL")) : Name.Left(Name.Find(TEXT("(")) > 0 ? Name.Find(TEXT("(")) : Name.Len()).TrimEnd().ToUpper()) : Pick(Boxes, H >> 6);
		const FColor Col = bGrocery ? Pick(Letters, H >> 9) : Pick(Letters, H >> 10);
		K.Text(Str, F.At(Se, 305, 1075 * Ez), F.Out, 190, 1600, Col == FColor(250, 250, 245) ? FColor(196, 20, 18) : Col);
		// pilasters every 9-10 m clear of the portal, the cornice along the top
		const TArray<FBWSlotMat> PM = Mats({ { TEXT("wall"), S.Pier } });
		const int32 Np = FMath::Max(2, FMath::RoundToInt(F.L / 950.0));
		for (int32 i = 0; i <= Np; ++i)
		{
			const double Sx = FMath::Clamp(F.L * i / Np, 50.0, F.L - 50.0);
			if (FMath::Abs(Sx - Se) < 1050) continue;
			K.Add(RETM("SM_RK_Pier"), F.T(Sx, 0, 0, FVector(1.5, 1.3, (Ht + 140) / 650.0)), PM);
		}
		K.Add(RETM("SM_RK_Cornice"), F.T(F.L * 0.5, 6, Ht + 120, FVector(F.L / 100.0, 1, 0.8)));
		if (bGrocery || V.Role == TEXT("dept"))
		{
			// glazing and canopies either side of the entry: the produce windows, the cart bay
			for (const double Sx : { Se - 1600, Se - 2250, Se + 1600, Se + 2250 })
			{
				if (Sx < 400 || Sx > F.L - 400) continue;
				K.Add(RETM("SM_RK_Storefront"), F.T(Sx, 14, 0, FVector(1.0, 1, 1)));
				K.Add(RETM("SM_RK_Canopy"), F.T(Sx, 18, 30, FVector(1.06, 1.2, 1)));
			}
			// the departments' names along the band
			if (bGrocery)
			{
				// (centred in a pilaster bay, clear of the piers)
				auto BayMid = [&](double Want) { const double Step = F.L / Np; return FMath::Clamp((FMath::FloorToDouble(Want / Step) + 0.5) * Step, Step * 0.5, F.L - Step * 0.5); };
				const double Bw = F.L / Np - 200;
				K.Text(TEXT("PHARMACY"), F.At(BayMid(Se - 2900), 14, Ht - 60), F.Out, 75, Bw, FColor(20, 52, 150));
				K.Text(TEXT("BAKERY  DELI"), F.At(BayMid(Se + 2900), 14, Ht - 60), F.Out, 75, Bw, FColor(150, 30, 20));
			}
			// CART CORRALS on the sidewalk by the doors
			for (const double Sx : { Se - 1250, Se + 1250 })
				if (Sx > 300 && Sx < F.L - 300) K.Add(RETM("SM_RK_CartCorral"), F.T(Sx, 160, G));
		}
		else
		{
			// a big box: an outdoor display or garden centre fence at one end, bollards at the doors
			for (int32 i = -3; i <= 3; ++i) if (i != 0) K.Add(KITM("SM_K_Bollard"), F.T(Se + i * 250, 330, G));
			K.Add(RETM("SM_RK_CartCorral"), F.T(Se + 1300, 160, G));
		}
		// THE DOCKS: dock doors bunched at one end of the back wall, trailers backed to some
		const int32 Nd = FMath::Clamp(FMath::RoundToInt(B.L / 2500.0), 2, 5);
		const bool bLeft = (H >> 8) % 2 == 0;
		for (int32 i = 0; i < Nd; ++i)
		{
			const double Sx = bLeft ? 600 + i * 450 : B.L - 600 - i * 450;
			K.Add(KITM("SM_K_DockDoor"), B.T(Sx, 0, 0));
			if (Rng.FRand() < 0.55) K.Add(KITM("SM_K_Trailer"), B.T(Sx, 12, G, FVector(1), 90), Mats({ { TEXT("accent"), Rng.FRand() < 0.7 ? FGM("Paint", "PaintedMetal_White") : FGM("Paint", "PaintedMetal_Grey") } }));
		}
		// a compactor beside the docks, man doors along the back
		const double Sc = bLeft ? 600 + Nd * 450 + 200 : B.L - 600 - Nd * 450 - 200;
		K.Add(KITM("SM_K_Unit"), B.T(Sc, 150, G, FVector(2.4, 3.0, 1.6)), Mats({ { TEXT("wall"), FGM("Paint", "PaintedMetal_Green") } }));
		K.Add(KITM("SM_K_ManDoor"), B.T(bLeft ? B.L - 900 : 900, 0, 0));
		K.Add(KITM("SM_K_ManDoor"), B.T(B.L * 0.5, 0, 0));
		RoofPlant(300, 36, 1.5);
		return;
	}

	// ---------------------------------------------------------------- PADS
	// (a pad stands inside its own car park: the stalls keep off its walls, and off its front by a drive aisle)
	if (IsPad(V.Role))
	{
		KeepOut.Add(BWInsetRing(V.Ring, -450));
		KeepOut.Add(F.Rect(-300, F.L + 300, 0, 1000));
	}
	// THE PAD'S FRONT: storefront across the middle, piers at its ends
	auto PadFront = [&](double Width, int32 Bays)
	{
		const double S0 = (F.L - Width) * 0.5, W = Width / Bays;
		for (int32 i = 0; i < Bays; ++i) K.Add(RETM("SM_RK_Storefront"), F.T(S0 + W * (i + 0.5), 14, 0, FVector((W - 40) / 600.0, 1, 1)));
		for (int32 i = 0; i <= Bays; ++i) K.Add(RETM("SM_RK_Pier"), F.T(S0 + W * i, 0, 0, FVector(1, 1, (Ht - 60) / 650.0)), Mats({ { TEXT("wall"), S.Pier } }));
	};
	// A CANOPY on columns: a deck with a fascia round it (the brand's stripe), over a rectangle in a face's frame
	auto Canopy = [&](const FFace& Fc, double S0, double S1, double O0, double O1, double Z, double Fascia, int32 Brand, double ColStep)
	{
		const double W = S1 - S0, Dd = O1 - O0, Sm = (S0 + S1) * 0.5, Om = (O0 + O1) * 0.5;
		K.Add(KITM("SM_K_Unit"), Fc.T(Sm, Om, Z, FVector(W / 100.0, Dd / 100.0, 0.25)), Mats({ { TEXT("wall"), SolidPath(SEifsWhite) } }));
		const TArray<FBWSlotMat> White = Mats({ { TEXT("wall"), FGM("Paint", "PaintedMetal_White") } });
		const TArray<FBWSlotMat> Stripe = Mats({ { TEXT("wall"), SolidPath(Brand) } });
		// fascia: white with the brand's stripe along the bottom, all four sides
		K.Add(KITM("SM_K_Unit"), Fc.T(Sm, O0, Z - Fascia * 0.25, FVector(W / 100.0 + 0.1, 0.12, Fascia / 100.0)), White);
		K.Add(KITM("SM_K_Unit"), Fc.T(Sm, O1, Z - Fascia * 0.25, FVector(W / 100.0 + 0.1, 0.12, Fascia / 100.0)), White);
		K.Add(KITM("SM_K_Unit"), Fc.T(S0, Om, Z - Fascia * 0.25, FVector(0.12, Dd / 100.0 + 0.1, Fascia / 100.0)), White);
		K.Add(KITM("SM_K_Unit"), Fc.T(S1, Om, Z - Fascia * 0.25, FVector(0.12, Dd / 100.0 + 0.1, Fascia / 100.0)), White);
		K.Add(KITM("SM_K_Unit"), Fc.T(Sm, O1 + 7, Z - Fascia * 0.25 + 4, FVector(W / 100.0 + 0.1, 0.03, Fascia * 0.3 / 100.0)), Stripe);
		K.Add(KITM("SM_K_Unit"), Fc.T(Sm, O0 - 7, Z - Fascia * 0.25 + 4, FVector(W / 100.0 + 0.1, 0.03, Fascia * 0.3 / 100.0)), Stripe);
		// columns
		const int32 Nc = FMath::Max(1, FMath::RoundToInt(W / ColStep));
		for (int32 i = 0; i <= Nc; ++i)
			for (const double Oc : { O0 + Dd * 0.3, O0 + Dd * 0.7 })
				K.Add(KITM("SM_K_Column"), Fc.T(S0 + 120 + (W - 240) * i / Nc, Oc, G, FVector(1, 1, (Z - G) / 100.0)), Mats({ { TEXT("accent"), FGM("Paint", "PaintedMetal_White") } }));
		KeepOut.Add(Fc.Rect(S0 - 150, S1 + 150, O0 - 150, O1 + 150));
	};
	if (V.Role == TEXT("qsr"))
	{
		PadFront(FMath::Min(F.L - 250, 1250.0), 2);
		K.Text(Pick(Qsrs, H >> 4), F.At(F.L * 0.5, 30, Ht - 40), F.Out, 95, F.L * 0.8, FColor(250, 250, 245));
		K.Text(Pick(Qsrs, H >> 4), Sd.At(Sd.L * 0.5, 30, Ht - 40), Sd.Out, 80, Sd.L * 0.7, FColor(250, 250, 245));
		// THE DRIVE-THROUGH: a lane round the side and the back, a kerbed island between it and the lot,
		// the menu board at the back corner, the pickup window under a canopy on the side
		const TArray<FBWSlotMat> Conc = Mats({ { TEXT("wall"), SolidPath(SConcrete) } });
		K.Add(KITM("SM_K_Unit"), Sd.T(Sd.L * 0.5, 520, G - 5, FVector(Sd.L / 100.0 + 5.2, 0.6, 0.2)), Conc);
		K.Add(KITM("SM_K_Unit"), B.T(B.L * 0.5, 520, G - 5, FVector(B.L / 100.0 + 5.2, 0.6, 0.2)), Conc);
		// (the queue runs from the window back toward the menu board: along the side, away from the front)
		const double Back = FVector2D::DotProduct(Sd.Dir, F.Out) > 0 ? -1.0 : 1.0;
		const double Win = Back > 0 ? Sd.L * 0.3 : Sd.L * 0.7;
		// the menu board on the back lane, at the corner the lane turns from
		K.Add(RETM("SM_RK_MenuBoard"), B.T(FVector2D::DotProduct(B.Dir, Sd.Out) > 0 ? B.L - 150 : 150, 470, G, FVector(1), 180));
		K.Add(RETM("SM_RK_Canopy"), Sd.T(Win, 4, 0, FVector(0.5, 1, 1)));
		K.Add(RETM("SM_RK_Storefront"), Sd.T(Win, 14, 0, FVector(0.3, 1, 1)));
		// cars queued in the lane, nose to tail toward the window
		for (int32 c = 0; c < 2 + int32((H >> 6) % 2); ++c)
			K.Add(Cars[(H >> (c * 3)) % UE_ARRAY_COUNT(Cars)], Sd.T(Win + Back * 650 * c, 260, G - 8, FVector(1), Back > 0 ? 180.0 : 0.0));
		KeepOut.Add(Sd.Rect(-600, Sd.L + 600, 0, 650));
		KeepOut.Add(B.Rect(-600, B.L + 600, 0, 650));
		// the tall pole sign at the road
		K.Add(KITM("SM_K_Column"), F.T(F.L * 0.15, 2600, G, FVector(1.2, 1.2, 9.0)), Mats({ { TEXT("accent"), RK("Bronze") } }));
		K.Add(RETM("SM_RK_SignBox"), F.T(F.L * 0.15, 2590, 860, FVector(3.4, 1, 2.0)), Mats({ { TEXT("accent"), Pick(Glows, H >> 9) } }));
		K.Text(Pick(Qsrs, H >> 4), F.At(F.L * 0.15, 2616, 960), F.Out, 50, 300, FColor(250, 250, 245));
		RoofPlant(150, 3);
		K.Add(KITM("SM_K_ManDoor"), B.T(B.L * 0.3, 0, 0));
		K.Add(Dumpster, B.T(B.L * 0.75, 900, G, FVector(1), 90));
		return;
	}
	if (V.Role == TEXT("bank"))
	{
		// brick, a white cornice, a hip roof; the entry under a gabled tower; the teller lanes under a canopy on the side
		K.Add(KITM("SM_K_Pyramid"), FTransform(FRotator(0, F.Yaw, 0), FVector(Ctr, V.Z0 + Ht), FVector((F.L + 80) / 100.0, (F.D + 80) / 100.0, 2.6)), Mats({ { TEXT("roof"), Pick(MetalRoofs, H >> 5) } }));
		K.Add(RETM("SM_RK_Tower"), F.T(F.L * 0.5, 0, 0, FVector(0.75, 0.75, (Ht + 120) / 1050.0)), Mats({ { TEXT("wall"), SolidPath(SEifsWhite) }, { TEXT("roof"), Pick(MetalRoofs, H >> 5) } }));
		for (const double Sx : { F.L * 0.2, F.L * 0.8 }) K.Add(RETM("SM_RK_Storefront"), F.T(Sx, 14, 0, FVector(0.45, 1, 0.75)));
		K.Text(Pick(Banks, H >> 3), F.At(F.L * 0.5, 200, 640 * (Ht + 120) / 1050.0), F.Out, 45, 520, FColor(30, 40, 70));
		Canopy(Sd, Sd.L * 0.1, Sd.L * 0.9, 150, 1250, 480, 70, SBrandBlue, 400);
		// the teller islands under it, with an ATM on the outer one
		for (const double Oi : { 520.0, 880.0 })
			K.Add(KITM("SM_K_Unit"), Sd.T(Sd.L * 0.5, Oi, G, FVector(Sd.L * 0.5 / 100.0, 0.9, 0.15)), Mats({ { TEXT("wall"), SolidPath(SConcrete) } }));
		K.Add(KITM("SM_K_Unit"), Sd.T(Sd.L * 0.5, 880, G + 15, FVector(0.8, 0.6, 1.6)), Mats({ { TEXT("wall"), SolidPath(SBronze) } }));
		RoofPlant(300, 2);
		return;
	}
	if (V.Role == TEXT("gas") || V.Role == TEXT("truckstop") || V.Role == TEXT("general"))
	{
		const bool bTruck = V.Role == TEXT("truckstop"), bGeneral = V.Role == TEXT("general");
		PadFront(FMath::Min(F.L - 200, bTruck ? 2400.0 : 1500.0), bTruck ? 4 : 2);
		const FString Brand = bGeneral ? (Name.IsEmpty() ? FString(TEXT("GENERAL STORE")) : Name.ToUpper()) : FString(Pick(Fuels, H >> 4));
		K.Text(bGeneral ? FString(TEXT("GENERAL STORE")) : Brand, F.At(F.L * 0.5, 30, bGeneral ? Ht + 70 : Ht - 40), F.Out, bGeneral ? 70 : 85, F.L * 0.75, bGeneral ? FColor(30, 30, 32) : FColor(250, 250, 245));
		if (bGeneral) K.Add(RETM("SM_RK_Awning"), F.T(F.L * 0.5, 18, 0, FVector((F.L - 100) / 600.0, 1, 1)), Mats({ { TEXT("fabric"), Pick(Awnings, H >> 7) } }));
		// THE PUMP CANOPY between the store and the road, islands under it across the lanes
		const double Wc = bGeneral ? 900 : FMath::Clamp(F.L * (bTruck ? 2.2 : 1.3), 1800.0, bTruck ? 4800.0 : 3200.0);
		const double O0 = bGeneral ? 500 : 800, Dc = bGeneral ? 700 : bTruck ? 2000 : 1500;
		const double Zc = bTruck ? 640 : 500;
		Canopy(F, F.L * 0.5 - Wc * 0.5, F.L * 0.5 + Wc * 0.5, O0, O0 + Dc, Zc, bGeneral ? 50 : 90, S.Brand, 650);
		const int32 Ni = FMath::Max(1, FMath::RoundToInt(Wc / 650.0));
		for (int32 i = 0; i < Ni; ++i)
		{
			const double Sx = F.L * 0.5 - Wc * 0.5 + Wc * (i + 0.5) / Ni;
			K.Add(RETM("SM_RK_PumpIsland"), F.T(Sx, O0 + Dc * 0.5, G, FVector(bTruck ? 1.3 : 1, 1, 1), 90));
			// a customer at the pump now and then
			if (Rng.FRand() < 0.4) K.Add(Cars[Rng.RandRange(0, UE_ARRAY_COUNT(Cars) - 1)], F.T(Sx + 230, O0 + Dc * 0.5, G - 8, FVector(1), 90));
		}
		// the price sign at the road: a lit cabinet on a masonry base
		if (!bGeneral)
		{
			const double Op = O0 + Dc + 900;
			K.Add(KITM("SM_K_Unit"), F.T(F.L * 0.15, Op, G, FVector(2.6, 0.7, 1.0)), Mats({ { TEXT("wall"), SolidPath(S.Base) } }));
			K.Add(RETM("SM_RK_SignBox"), F.T(F.L * 0.15, Op - 10, G + 100, FVector(2.4, 1, 2.6)), Mats({ { TEXT("accent"), Pick(Glows, H >> 11) } }));
			K.Text(Brand, F.At(F.L * 0.15, Op + 14, G + 310), F.Out, 32, 220, FColor(250, 250, 245));
			K.Text(FString::Printf(TEXT("%d.%02d"), 2 + int32((H >> 3) % 2), 49 + int32((H >> 5) % 50)), F.At(F.L * 0.15, Op + 14, G + 200), F.Out, 50, 220, FColor(240, 30, 20));
			KeepOut.Add(F.Rect(F.L * 0.15 - 300, F.L * 0.15 + 300, Op - 200, Op + 200));
		}
		// the ice chest and propane cage by the door
		K.Add(KITM("SM_K_Unit"), F.T(F.L * 0.5 + 600, 90, G, FVector(1.8, 0.8, 1.2)), Mats({ { TEXT("wall"), FGM("Paint", "PaintedMetal_White") } }));
		RoofPlant(200, 3);
		K.Add(KITM("SM_K_ManDoor"), B.T(B.L * 0.5, 0, 0));
		K.Add(Dumpster, B.T(B.L * 0.3, 300, G, FVector(1), 90));
		return;
	}
}
