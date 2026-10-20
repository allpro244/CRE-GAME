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
	M.Mesh = LoadObject<UStaticMesh>(nullptr, *M.Path);
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
	for (const FBWKitBand& B : Bands) if (B.bRepeat && B.Walls.Num()) Grid = B.Walls[0].Width;
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

int32 FBWFacadeBuilder::Dress(const FBWKit& Kit, const FBWVolume& V, uint32 Seed, bool bGround, const FLinearColor& Tint)
{
	{
		auto Q = [](float X) { return uint32(FMath::Clamp(FMath::RoundToInt(X / 0.04f), 1, 255)); };
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
		if (!bGround && B.bGround) continue;                           // upper tiers have no shopfront floor
		Order.Add(&B);
		if (B.bRepeat) Reps.Add(&B); else FixedH += B.Height;
	}
	if (Order.Num() == 0) return 0;
	TMap<const FBWKitBand*, int32> Count;
	double Squeeze = 1.0;
	if (H > FixedH && Reps.Num())
	{
		double RepH = 0;
		for (const FBWKitBand* B : Reps) RepH += B->Height;
		const int32 Total = FMath::Max(0, FMath::RoundToInt((H - FixedH) / (RepH / Reps.Num())));
		for (int32 i = 0; i < Reps.Num(); ++i) Count.Add(Reps[i], Total / Reps.Num() + (i < Total % Reps.Num() ? 1 : 0));
	}
	else
	{
		// shorter than the fixed stack: drop the middle fixed bands until it fits, then squeeze
		while (FixedH > H * 1.15 && Order.Num() > 2)
		{
			const int32 Mid = Order.Num() / 2;
			if (!Order[Mid]->bRepeat) FixedH -= Order[Mid]->Height;
			Order.RemoveAt(Mid);
		}
		for (const FBWKitBand* B : Reps) Count.Add(B, 0);
	}
	double StackH = 0;
	for (const FBWKitBand* B : Order) StackH += B->bRepeat ? B->Height * Count.FindRef(B) : B->Height;
	Squeeze = StackH > 0 ? H / StackH : 1.0;
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
	const TArray<int32>& Rhythm = Rhythms[Rng.RandRange(0, Rhythms.Num() - 1)];
	const int32 DoorEvery = Rng.RandRange(3, 5);
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
				for (const FBWKitModule& M : Band.Walls) All.Add(&M);
				All.Sort([W](const FBWKitModule& X, const FBWKitModule& Y) { return FMath::Abs(X.Width - W) < FMath::Abs(Y.Width - W); });
				const int32 Keep = FMath::Min(All.Num(), 4);
				// shuffle among the best fits so neighbours of one kit still differ
				for (int32 k = 0; k < Keep; ++k) Pal.Add(All[k]);
				for (int32 k = Pal.Num() - 1; k > 0; --k) Pal.Swap(k, Rng.RandRange(0, k));
			}
			if (bConvex && Band.bHasCorner) Put(Band.Corner, A, D, Out, 0, Corner, Row.Z, Row.ScaleZ);
			for (int32 k = 0; k < Mods; ++k)
			{
				const FBWKitModule* M = Pal[Rhythm[k % Rhythm.Num()] % Pal.Num()];
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
