#include "FacadeBuilder.h"
#include "Materials/MaterialInstanceDynamic.h"

#include "CityData.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Dom/JsonObject.h"
#include "Engine/StaticMesh.h"
#include "Misc/FileHelper.h"
#include "Misc/PackageName.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

DEFINE_LOG_CATEGORY_STATIC(LogBWFacade, Log, All);

static bool ReadModule(const TSharedPtr<FJsonObject>& O, FBWKitModule& M)
{
	if (!O.IsValid()) return false;
	M.Path = O->GetStringField(TEXT("path"));
	M.Width = O->GetNumberField(TEXT("width"));
	M.Depth = O->GetNumberField(TEXT("depth"));
	M.Y0 = O->GetNumberField(TEXT("y0"));
	M.Y1 = O->GetNumberField(TEXT("y1"));
	O->TryGetNumberField(TEXT("every"), M.Every);
	M.Mesh = LoadObject<UStaticMesh>(nullptr, *M.Path);
	// a kit holds its meshes by plain pointer, so they are rooted: the collector
	// frees a mesh no component shows yet, and the next building to use it crashed
	if (M.Mesh) M.Mesh->AddToRoot();
	// the decal companion sits beside the mesh (.../Mesh/X_decal) or in a sibling
	// folder (.../decal/X_decal); without it every wall reads factory-clean
	{
		const FString Pkg = FPackageName::ObjectPathToPackageName(M.Path);
		const FString Name = FPackageName::GetShortName(Pkg);
		const FString Dir = FPackageName::GetLongPackagePath(Pkg);
		const FString Up = FPackageName::GetLongPackagePath(Dir);
		for (const FString& Cand : { Dir / Name + TEXT("_decal"), Up / TEXT("decal") / Name + TEXT("_decal"), Dir / Name + TEXT("_Decal"), Up / TEXT("decal") / Name + TEXT("_Decal") })
		{
			if (!FPackageName::DoesPackageExist(Cand)) continue;
			M.Decal = LoadObject<UStaticMesh>(nullptr, *(Cand + TEXT(".") + FPackageName::GetShortName(Cand)));
			if (M.Decal) M.Decal->AddToRoot();
			if (M.Decal) break;
		}
	}
	if (!M.Mesh) UE_LOG(LogBWFacade, Warning, TEXT("kit mesh missing: %s (run unreal/tools/migrate-kit.mjs)"), *M.Path);
	return M.Mesh != nullptr;
}

bool FBWKit::Load(const FString& Path)
{
	FString Text;
	TSharedPtr<FJsonObject> R;
	if (!FFileHelper::LoadFileToString(Text, *Path) || !FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Text), R) || !R.IsValid()) return false;
	Name = R->GetStringField(TEXT("kit"));
	for (const TSharedPtr<FJsonValue>& V : R->GetArrayField(TEXT("bands")))
	{
		const TSharedPtr<FJsonObject> O = V->AsObject();
		FBWKitBand& B = Bands.AddDefaulted_GetRef();
		B.Symbol = O->GetStringField(TEXT("symbol"));
		B.Height = O->GetNumberField(TEXT("height"));
		B.bRepeat = O->GetBoolField(TEXT("repeat"));
		O->TryGetBoolField(TEXT("ground"), B.bGround);
		for (const TSharedPtr<FJsonValue>& W : O->GetArrayField(TEXT("walls"))) { FBWKitModule M; if (ReadModule(W->AsObject(), M)) B.Walls.Add(M); }
		for (const TSharedPtr<FJsonValue>& W : O->GetArrayField(TEXT("entrances"))) { FBWKitModule M; if (ReadModule(W->AsObject(), M)) B.Entrances.Add(M); }
		const TSharedPtr<FJsonObject>* C;
		if (O->TryGetObjectField(TEXT("corner"), C)) B.bHasCorner = ReadModule(*C, B.Corner);
	}
	// the bay: the shaft piece nearest a window bay's 3 m (the first piece listed
	// is often a 1 m blank pier, and a grid of piers is a wall with no windows)
	for (const FBWKitBand& B : Bands) if (B.bRepeat && B.Walls.Num())
	{
		Grid = B.Walls[0].Width;
		for (const FBWKitModule& M : B.Walls) if (FMath::Abs(M.Width - 300.0) < FMath::Abs(Grid - 300.0)) Grid = M.Width;
		break;
	}
	// ...unless the kit names its bay (set by eye from the renders, where the rule picks a blank piece)
	R->TryGetNumberField(TEXT("grid"), Grid);
	int32 Decals = 0, Pieces = 0;
	for (const FBWKitBand& B : Bands) for (const FBWKitModule& M : B.Walls) { ++Pieces; Decals += M.Decal ? 1 : 0; }
	UE_LOG(LogBWFacade, Display, TEXT("kit %s: %d bands, %.0f cm grid, %d/%d wall pieces weathered"), *Name, Bands.Num(), Grid, Decals, Pieces);
	return Bands.Num() > 0;
}

void FBWFacadeBuilder::Reset()
{
	for (TPair<TPair<UStaticMesh*, uint32>, UInstancedStaticMeshComponent*>& C : Comps) if (C.Value) C.Value->ClearInstances();
	Placed = 0;
}

UInstancedStaticMeshComponent* FBWFacadeBuilder::Comp(UStaticMesh* Mesh, bool bTinted)
{
	const uint32 Key = bTinted ? TintKey : 0;
	if (UInstancedStaticMeshComponent** Found = Comps.Find(TPair<UStaticMesh*, uint32>(Mesh, Key))) return *Found;
	UInstancedStaticMeshComponent* C = NewObject<UInstancedStaticMeshComponent>(Parent->GetOwner());
	C->SetupAttachment(Parent);
	C->SetStaticMesh(Mesh);
	C->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	// THE WALL TINT. Every kit material is an instance of City Sample's building
	// master, whose main layer (M1) multiplies its albedo by "Color Tint/Mult(A) M1";
	// the web family's tint scales that, so one kit comes in its family's brick
	// batches, stone creams and glass casts. The weathering decal keeps its own.
	if (Key)
		for (int32 Slot = 0; Slot < C->GetNumMaterials(); ++Slot)
		{
			UMaterialInterface* Base = C->GetMaterial(Slot);
			if (!Base) continue;
			const TPair<UMaterialInterface*, uint32> MK(Base, Key);
			UMaterialInstanceDynamic* MID = nullptr;
			if (UMaterialInstanceDynamic** Have = Tinted.Find(MK)) MID = *Have;
			else
			{
				static const FName P(TEXT("Color Tint/Mult(A) M1"));
				FLinearColor Cur(1, 1, 1, 1);
				if (Base->GetVectorParameterValue(FHashedMaterialParameterInfo(P), Cur))
				{
					MID = UMaterialInstanceDynamic::Create(Base, Parent->GetOwner());
					MID->SetVectorParameterValue(P, FLinearColor(Cur.R * TintNow.R, Cur.G * TintNow.G, Cur.B * TintNow.B, Cur.A));
				}
				Tinted.Add(MK, MID);
			}
			if (MID) C->SetMaterial(Slot, MID);
		}
	C->RegisterComponent();
	Comps.Add(TPair<UStaticMesh*, uint32>(Mesh, Key), C);
	return C;
}

// One piece covering [S, S+W] along the edge from A (direction D, outward normal
// Out), its face on the footprint line, bottom at Z. The kit's meshes face +X
// with their width along Y, anchored at their Y0..Y1 extent; we pick the Y axis
// sign that keeps +Z up (Unreal's frame is left-handed, so X ^ Y must be +Z) and
// anchor whichever end of the piece that makes the start.
void FBWFacadeBuilder::Put(const FBWKitModule& M, const FVector2D& A, const FVector2D& D, const FVector2D& Out, double S, double W, double Z, double ScaleZ)
{
	if (!M.Mesh) return;
	const FVector X(Out, 0);
	FVector Y(D, 0);
	const bool bFlip = FVector::CrossProduct(X, Y).Z < 0;
	if (bFlip) Y = -Y;
	const double Span = FMath::Max(1.0, M.Y1 - M.Y0);
	const double SY = W / Span;
	// world position along the edge of mesh-space y: S + (y - Y0)*SY going +D, or mirrored
	const double Origin = bFlip ? S + M.Y1 * SY : S - M.Y0 * SY;
	const FVector2D P = A + D * Origin;
	const FMatrix R = FRotationMatrix::MakeFromXY(X, Y);
	const FTransform T(R.Rotator(), FVector(P, Z), FVector(1.0, SY, ScaleZ));
	Comp(M.Mesh)->AddInstance(T);
	if (M.Decal) Comp(M.Decal, false)->AddInstance(T);
	++Placed;
}

int32 FBWFacadeBuilder::Dress(const FBWKit& Kit, const FBWVolume& V, uint32 Seed, bool bGround, const FLinearColor& Tint, bool bExactTint)
{
	{
		// the web family's tint is drawn for a flat painted wall; on a scanned kit
		// material with its own colour it barely registered, so its departure
		// from white is doubled (clamped to a plausible paint range)
		auto Q = [bExactTint](float X) { return uint32(FMath::Clamp(FMath::RoundToInt(FMath::Clamp(bExactTint ? X : 1.f + 2.2f * (X - 1.f), 0.4f, 1.6f) / 0.04f), 1, 255)); };
		const uint32 R = Q(Tint.R), G = Q(Tint.G), B = Q(Tint.B);
		TintKey = (R == 25 && G == 25 && B == 25) ? 0 : (R << 16) | (G << 8) | B;   // 25 x 0.04 = 1: untinted
		TintNow = FLinearColor(R * 0.04f, G * 0.04f, B * 0.04f);
	}
	const int32 Before = Placed;
	const int32 N = V.Ring.Num();
	const double H = V.Z1 - V.Z0;
	if (N < 3 || H < 400) return 0;
	FRandomStream Rng((int32)Seed);

	// ---- the vertical stack, in grammar order. Fixed bands once each; the
	// repeating bands (some kits have two: lower and upper shafts) share the
	// floors that are left, each stretched a little so the stack lands on the roof.
	TArray<const FBWKitBand*> Order, Reps;
	double FixedH = 0;
	for (const FBWKitBand& B : Kit.Bands)
	{
		if (B.Height < 10 || B.Walls.Num() == 0) continue;           // the footing slot is a hairline
		if ((!bGround || V.Look.Ground == TEXT("plain")) && B.bGround) continue;   // upper tiers have no shopfront floor; nor a building the player ran to the pavement
		Order.Add(&B);
		if (B.bRepeat) Reps.Add(&B); else FixedH += B.Height;
	}
	if (Order.Num() == 0) return 0;
	// ONE ROW OF WINDOWS PER FLOOR. The kit's bands carry their own storey
	// heights (3 m to 9 m: a tall band is a double-height floor), and the
	// stack used to repeat the shaft band by HEIGHT, so a ten-storey building in
	// a kit with a 6 m shaft showed six rows of windows. Now the building's
	// floors are counted (the generator's 3.55 m storey; what is left over is
	// the parapet) and each band is counted as the storeys it spans; the
	// repeating bands make up the difference, then the whole stack is scaled
	// to land on the roof. On a low building the fixed bands that do not fit
	// are dropped from the middle (keeping the street floor and the cornice).
	// BASE, ONE SHAFT, TOP. The City Sample kits are designed buildings: above
	// the shaft come one-off crown tiers, setback belts and a second shaft,
	// drawn for a tower that steps back. On our straight extrusions those
	// pieces stacked into ribs and crowns halfway up the wall. So the stack is
	// the base bands (street floor up to the shaft), the first repeating band
	// as the whole shaft, and the kit's last band (cornice or parapet) on top.
	{
		int32 FirstRep = -1;
		for (int32 k = 0; k < Order.Num(); ++k) if (Order[k]->bRepeat) { FirstRep = k; break; }
		if (FirstRep >= 0)
		{
			const FBWKitBand* Top = Order.Last();
			const bool bTop = V.Look.Top != TEXT("plain") && Order.Num() - 1 > FirstRep;
			Order.SetNum(FirstRep + 1);
			if (bTop) Order.Add(Top);
			Reps = { Order[FirstRep] };
			// A SETBACK TIER IS THE SAME BUILDING, NOT ANOTHER ONE ON ITS ROOF: it
			// carries the shaft on up and its own parapet, never the base again
			// (stacked bases read as three buildings piled up)
			if (!bGround) Order.RemoveAt(0, FirstRep);
		}
	}
	auto Storeys = [](const FBWKitBand* B) { return FMath::Max(1, FMath::RoundToInt(B->Height / 450.0)); };
	const int32 Floors = FMath::Max(1, FMath::FloorToInt(H / 355.0 + 0.2));
	int32 FixedS = 0;
	for (const FBWKitBand* B : Order) if (!B->bRepeat) FixedS += Storeys(B);
	while (FixedS > Floors && Order.Num() > 1)
	{
		// drop the fixed band nearest the middle; never the street floor (first) or the top (last) while others remain
		int32 Drop = -1;
		for (int32 k = Order.Num() / 2, step = 0; step < Order.Num(); ++step, k = (k + 1) % Order.Num())
			if (!Order[k]->bRepeat && (Order.Num() <= 2 || (k != 0 && k != Order.Num() - 1))) { Drop = k; break; }
		if (Drop < 0) break;
		FixedS -= Storeys(Order[Drop]);
		Order.RemoveAt(Drop);
	}
	Reps.RemoveAll([&Order](const FBWKitBand* B) { return !Order.Contains(B); });
	TMap<const FBWKitBand*, int32> Count;
	{
		int32 Left = FMath::Max(0, Floors - FixedS);
		// fill with the repeating bands in turn, each taking its own storey count
		int32 Guard = 0;
		while (Left > 0 && Reps.Num() && Guard++ < 200)
			for (const FBWKitBand* B : Reps)
			{
				if (Left <= 0) break;
				const int32 S = Storeys(B);
				if (S > Left && Count.FindRef(B) > 0) { Left = 0; break; }
				Count.FindOrAdd(B)++;
				Left -= S;
			}
	}
	double StackH = 0;
	for (const FBWKitBand* B : Order) StackH += B->bRepeat ? B->Height * Count.FindRef(B) : B->Height;
	const double Squeeze = StackH > 0 ? H / StackH : 1.0;
	struct FRow { const FBWKitBand* Band; double Z, ScaleZ; };
	TArray<FRow> Rows;
	double Z = V.Z0;
	for (const FBWKitBand* B : Order)
	{
		const int32 Times = B->bRepeat ? Count.FindRef(B) : 1;
		for (int32 i = 0; i < Times; ++i) { Rows.Add({ B, Z, Squeeze }); Z += B->Height * Squeeze; }
	}
	if (Rows.Num() == 0) return 0;

	// ---- this building's design: a bay rhythm shared by every floor, so the
	// windows stack, but a different rhythm (and different modules) per building
	static const TArray<TArray<int32>> Rhythms = { {0}, {0, 1}, {0, 0, 1}, {0, 1, 0, 2}, {1, 0, 0, 1}, {0, 1, 1}, {2, 0, 1, 0} };
	const int32 Pick = Rng.RandRange(0, Rhythms.Num() - 1);
	const TArray<int32>& Rhythm = Rhythms[Pick];   // (the desk's window setting is gone: some rhythms surfaced odd pieces)
	// "entrance": doors all along the street floor rather than one in a few bays
	const int32 DoorEvery = V.Look.Ground == TEXT("entrance") ? 2 : Rng.RandRange(3, 5);
	TMap<const FBWKitBand*, TArray<const FBWKitModule*>> Palette;

	double Area2 = 0;
	for (int32 i = 0; i < N; ++i) Area2 += V.Ring[i].X * V.Ring[(i + 1) % N].Y - V.Ring[(i + 1) % N].X * V.Ring[i].Y;

	for (int32 i = 0; i < N; ++i)
	{
		const FVector2D A = V.Ring[i], B = V.Ring[(i + 1) % N];
		const double Len = (B - A).Size();
		if (Len < 150) continue;
		const FVector2D D = (B - A) / Len;
		const FVector2D Out = Area2 > 0 ? FVector2D(D.Y, -D.X) : FVector2D(-D.Y, D.X);
		const FVector2D Prev = V.Ring[(i + N - 1) % N];
		const double Turn = FVector2D::CrossProduct(A - Prev, B - A);
		const bool bConvex = (Area2 > 0) == (Turn > 0);
		const double Corner = bConvex ? 100.0 : 0.0;
		const double Usable = Len - Corner;
		// a wall too short for one bay (a chamfer, a sliver beside a setback) is
		// plain wall: a window piece squeezed to a metre reads as a blank panel
		const bool bSliver = Usable < Kit.Grid * 0.6;
		const int32 Mods = FMath::Max(1, FMath::RoundToInt(Usable / Kit.Grid));
		const double W = Usable / Mods;

		for (const FRow& Row : Rows)
		{
			const FBWKitBand& Band = *Row.Band;
			// the modules that fit this bay with the least stretch, picked once per building
			TArray<const FBWKitModule*>& Pal = Palette.FindOrAdd(&Band);
			if (Pal.Num() == 0)
			{
				TArray<const FBWKitModule*> All;
				// not the light-court returns: pieces 1.5 m deep are drawn to turn into a
				// court, and on a flat wall they open dark slots between the bays
				double Shallow = 1e9;
				for (const FBWKitModule& M : Band.Walls) Shallow = FMath::Min(Shallow, M.Depth);
				for (const FBWKitModule& M : Band.Walls) if (M.Depth <= Shallow + 60) All.Add(&M);
				All.Sort([W](const FBWKitModule& X, const FBWKitModule& Y) { return FMath::Abs(X.Width - W) < FMath::Abs(Y.Width - W); });
				// only pieces that fit the bay: a kit's odd pieces (blank infill
				// panels, a 7.5 m feature bay) stretched to a 3 m bay looked broken,
				// and the window-placement rhythm brought them up on some buildings
				int32 Keep = 1;
				while (Keep < FMath::Min(All.Num(), 4) && FMath::Abs(All[Keep]->Width - W) <= FMath::Max(0.12 * W, FMath::Abs(All[0]->Width - W) + 15.0)) ++Keep;
				// shuffle among the best fits so neighbours of one kit still differ
				// (feature bays sit out of the palette: they go where Every puts them)
				for (int32 k = 0; k < Keep; ++k) if (All[k]->Every <= 0) Pal.Add(All[k]);
				if (Pal.Num() == 0) Pal.Add(All[0]);
				for (int32 k = Pal.Num() - 1; k > 0; --k) Pal.Swap(k, Rng.RandRange(0, k));
			}
			if (bSliver && Band.bHasCorner) { Put(Band.Corner, A, D, Out, 0, Len, Row.Z, Row.ScaleZ); continue; }
			if (bConvex && Band.bHasCorner) Put(Band.Corner, A, D, Out, 0, Corner, Row.Z, Row.ScaleZ);
			// THE FEATURE BAY. A tenement front carries a fire escape or two, not
			// one every other bay: a piece marked "every": N goes on one bay in N
			// (the middle of each run of N), and a wall too short for one gets none.
			const FBWKitModule* Feature = nullptr;
			for (const FBWKitModule& M : Band.Walls) if (M.Every > 0 && FMath::Abs(M.Width - W) <= 0.2 * W) { Feature = &M; break; }
			for (int32 k = 0; k < Mods; ++k)
			{
				const FBWKitModule* M = Pal[Rhythm[k % Rhythm.Num()] % Pal.Num()];
				if (Feature && Mods >= Feature->Every && (k % Feature->Every) == Feature->Every / 2) M = Feature;
				// street floor: a door every few bays on every frontage, shopfronts between
				if (Band.bGround && Band.Entrances.Num() && Mods > 1 && (k % DoorEvery) == DoorEvery / 2)
					M = &Band.Entrances[(i + k) % Band.Entrances.Num()];
				Put(*M, A, D, Out, Corner + k * W, W, Row.Z, Row.ScaleZ);
			}
		}
	}
	return Placed - Before;
}

TArray<FVector2D> BWInsetRing(const TArray<FVector2D>& Ring, double Inset)
{
	const int32 N = Ring.Num();
	double Area2 = 0;
	for (int32 i = 0; i < N; ++i) Area2 += Ring[i].X * Ring[(i + 1) % N].Y - Ring[(i + 1) % N].X * Ring[i].Y;
	TArray<FVector2D> Out;
	Out.Reserve(N);
	for (int32 i = 0; i < N; ++i)
	{
		const FVector2D P = Ring[i];
		const FVector2D D0 = (P - Ring[(i + N - 1) % N]).GetSafeNormal(), D1 = (Ring[(i + 1) % N] - P).GetSafeNormal();
		const FVector2D N0 = Area2 > 0 ? FVector2D(D0.Y, -D0.X) : FVector2D(-D0.Y, D0.X);
		const FVector2D N1 = Area2 > 0 ? FVector2D(D1.Y, -D1.X) : FVector2D(-D1.Y, D1.X);
		FVector2D Bis = (N0 + N1).GetSafeNormal();
		const double C = FMath::Max(0.35, FVector2D::DotProduct(Bis, N1));
		Out.Add(P - Bis * (Inset / C));
	}
	return Out;
}
