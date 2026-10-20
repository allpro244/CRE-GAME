#include "FacadeBuilder.h"

#include "CityData.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Dom/JsonObject.h"
#include "Engine/StaticMesh.h"
#include "Misc/FileHelper.h"
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
	M.Mesh = LoadObject<UStaticMesh>(nullptr, *M.Path);
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
	for (const FBWKitBand& B : Bands) if (B.bRepeat && B.Walls.Num()) Grid = B.Walls[0].Width;
	UE_LOG(LogBWFacade, Display, TEXT("kit %s: %d bands, %.0f cm grid"), *Name, Bands.Num(), Grid);
	return Bands.Num() > 0;
}

void FBWFacadeBuilder::Reset()
{
	for (TPair<UStaticMesh*, UInstancedStaticMeshComponent*>& C : Comps) if (C.Value) C.Value->ClearInstances();
	Placed = 0;
}

UInstancedStaticMeshComponent* FBWFacadeBuilder::Comp(UStaticMesh* Mesh)
{
	if (UInstancedStaticMeshComponent** Found = Comps.Find(Mesh)) return *Found;
	UInstancedStaticMeshComponent* C = NewObject<UInstancedStaticMeshComponent>(Parent->GetOwner());
	C->SetupAttachment(Parent);
	C->SetStaticMesh(Mesh);
	C->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	C->RegisterComponent();
	Comps.Add(Mesh, C);
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
	Comp(M.Mesh)->AddInstance(FTransform(R.Rotator(), FVector(P, Z), FVector(1.0, SY, ScaleZ)));
	++Placed;
}

int32 FBWFacadeBuilder::Dress(const FBWKit& Kit, const FBWVolume& V, uint32 Seed, bool bGround)
{
	const int32 Before = Placed;
	const int32 N = V.Ring.Num();
	const double H = V.Z1 - V.Z0;
	if (N < 3 || H < 400) return 0;

	// ---- the vertical stack: fixed bands, plus the repeating one as often as it fits
	TArray<const FBWKitBand*> Fixed;
	const FBWKitBand* Rep = nullptr;
	for (const FBWKitBand& B : Kit.Bands)
	{
		if (B.Height < 10 || B.Walls.Num() == 0) continue;           // the footing slot is a hairline
		if (B.bRepeat) { Rep = &B; continue; }
		if (!bGround && B.bGround) continue;                           // upper tiers have no shopfront floor
		Fixed.Add(&B);
	}
	double FixedH = 0;
	for (const FBWKitBand* B : Fixed) FixedH += B->Height;
	struct FRow { const FBWKitBand* Band; double Z, ScaleZ; };
	TArray<FRow> Rows;
	if (Rep && H > FixedH)
	{
		const int32 Count = FMath::Max(0, FMath::RoundToInt((H - FixedH) / Rep->Height));
		const double RepScale = Count > 0 ? (H - FixedH) / (Count * Rep->Height) : 1.0;
		double Z = V.Z0;
		// ground band(s) first (everything before the repeat in grammar order), then the repeat, then the top
		bool bRepeatDone = false;
		for (const FBWKitBand& B : Kit.Bands)
		{
			if (&B == Rep)
			{
				for (int32 i = 0; i < Count; ++i) { Rows.Add({ Rep, Z, RepScale }); Z += Rep->Height * RepScale; }
				bRepeatDone = true;
				continue;
			}
			if (!Fixed.Contains(&B)) continue;
			Rows.Add({ &B, Z, 1.0 });
			Z += B.Height;
		}
		if (Count == 0 && FixedH > 0) for (FRow& Row : Rows) Row.ScaleZ = H / FixedH; // squeeze the fixed bands to fit
	}
	else
	{
		// shorter than the kit's fixed stack: the fixed bands, squeezed to the height
		double Z = V.Z0;
		const double S = FixedH > 0 ? H / FixedH : 1.0;
		for (const FBWKitBand* B : Fixed) { Rows.Add({ B, Z, S }); Z += B->Height * S; }
	}
	if (Rows.Num() == 0) return 0;

	// ---- ring orientation: outward is right of the edge for a counter-clockwise ring
	double Area2 = 0;
	for (int32 i = 0; i < N; ++i) Area2 += V.Ring[i].X * V.Ring[(i + 1) % N].Y - V.Ring[(i + 1) % N].X * V.Ring[i].Y;

	// the longest edge of a ground floor gets the entrance
	int32 Front = 0;
	for (int32 i = 1; i < N; ++i) if ((V.Ring[(i + 1) % N] - V.Ring[i]).SizeSquared() > (V.Ring[(Front + 1) % N] - V.Ring[Front]).SizeSquared()) Front = i;

	FRandomStream Rng((int32)Seed);
	// one wall variant per band for the whole building, so it reads as one design
	TMap<const FBWKitBand*, int32> Variant;
	for (const FRow& Row : Rows) if (!Variant.Contains(Row.Band)) Variant.Add(Row.Band, Rng.RandRange(0, Row.Band->Walls.Num() - 1));

	for (int32 i = 0; i < N; ++i)
	{
		const FVector2D A = V.Ring[i], B = V.Ring[(i + 1) % N];
		const double Len = (B - A).Size();
		if (Len < 150) continue;
		const FVector2D D = (B - A) / Len;
		const FVector2D Out = Area2 > 0 ? FVector2D(D.Y, -D.X) : FVector2D(-D.Y, D.X);
		// convex corner at A? (the turn from the previous edge goes the ring's way)
		const FVector2D Prev = V.Ring[(i + N - 1) % N];
		const double Turn = FVector2D::CrossProduct(A - Prev, B - A);
		const bool bConvex = (Area2 > 0) == (Turn > 0);
		const double Corner = bConvex ? 100.0 : 0.0;
		const double Usable = Len - Corner;
		const int32 Mods = FMath::Max(1, FMath::RoundToInt(Usable / Kit.Grid));
		const double W = Usable / Mods;

		for (const FRow& Row : Rows)
		{
			const FBWKitBand& Band = *Row.Band;
			if (bConvex && Band.bHasCorner) Put(Band.Corner, A, D, Out, 0, Corner, Row.Z, Row.ScaleZ);
			const FBWKitModule& Wall = Band.Walls[Variant[&Band]];
			for (int32 k = 0; k < Mods; ++k)
			{
				const bool bDoor = bGround && i == Front && k == Mods / 2 && Band.Entrances.Num() > 0 && Band.bGround;
				Put(bDoor ? Band.Entrances[0] : Wall, A, D, Out, Corner + k * W, W, Row.Z, Row.ScaleZ);
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
