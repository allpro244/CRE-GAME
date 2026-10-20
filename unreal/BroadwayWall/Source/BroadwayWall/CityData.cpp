#include "CityData.h"

#include "Dom/JsonObject.h"
#include "Misc/FileHelper.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

DEFINE_LOG_CATEGORY_STATIC(LogBWCity, Log, All);

static TArray<FVector2D> ReadRing(const TSharedPtr<FJsonObject>& O, const TCHAR* Field = TEXT("ring"))
{
	TArray<FVector2D> Out;
	const TArray<TSharedPtr<FJsonValue>>* A;
	if (!O->TryGetArrayField(Field, A)) return Out;
	Out.Reserve(A->Num() / 2);
	for (int32 i = 0; i + 1 < A->Num(); i += 2) Out.Emplace((*A)[i]->AsNumber(), (*A)[i + 1]->AsNumber());
	return Out;
}

static TArray<FVector2D> ReadFlat(const TArray<TSharedPtr<FJsonValue>>& A)
{
	TArray<FVector2D> Out;
	Out.Reserve(A.Num() / 2);
	for (int32 i = 0; i + 1 < A.Num(); i += 2) Out.Emplace(A[i]->AsNumber(), A[i + 1]->AsNumber());
	return Out;
}

bool FBWCity::Load(const FString& Path)
{
	FString Text;
	if (!FFileHelper::LoadFileToString(Text, *Path))
	{
		UE_LOG(LogBWCity, Error, TEXT("cannot read %s"), *Path);
		return false;
	}
	return LoadText(Text, Path);
}

bool FBWCity::LoadText(const FString& Text, const FString& Path)
{
	TSharedPtr<FJsonObject> Root;
	if (!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Text), Root) || !Root.IsValid())
	{
		UE_LOG(LogBWCity, Error, TEXT("bad JSON in %s"), *Path);
		return false;
	}
	if (Root->GetStringField(TEXT("format")) != TEXT("bw-city/1"))
	{
		UE_LOG(LogBWCity, Error, TEXT("%s is not bw-city/1"), *Path);
		return false;
	}

	const TSharedPtr<FJsonObject> C = Root->GetObjectField(TEXT("city"));
	Name = C->GetStringField(TEXT("name"));
	Size = C->GetStringField(TEXT("size"));
	Seed = (int64)C->GetNumberField(TEXT("seed"));
	const TSharedPtr<FJsonObject> B = Root->GetObjectField(TEXT("bounds"));
	Bounds = FBox2D(FVector2D(B->GetNumberField(TEXT("minX")), B->GetNumberField(TEXT("minY"))),
		FVector2D(B->GetNumberField(TEXT("maxX")), B->GetNumberField(TEXT("maxY"))));

	for (const TSharedPtr<FJsonValue>& V : Root->GetArrayField(TEXT("parcels")))
	{
		const TSharedPtr<FJsonObject> O = V->AsObject();
		FBWParcel& P = Parcels.AddDefaulted_GetRef();
		P.Bbl = O->GetStringField(TEXT("bbl"));
		O->TryGetStringField(TEXT("address"), P.Address);
		O->TryGetStringField(TEXT("district"), P.District);
		O->TryGetStringField(TEXT("districtName"), P.DistrictName);
		O->TryGetStringField(TEXT("zone"), P.Zone);
		O->TryGetStringField(TEXT("cls"), P.Cls);
		O->TryGetNumberField(TEXT("floors"), P.Floors);
		O->TryGetNumberField(TEXT("yearBuilt"), P.YearBuilt);
		O->TryGetNumberField(TEXT("lotArea"), P.LotArea);
		O->TryGetNumberField(TEXT("bldgArea"), P.BldgArea);
		P.Ring = ReadRing(O);
		ParcelByBbl.Add(P.Bbl, Parcels.Num() - 1);
	}

	for (const TSharedPtr<FJsonValue>& V : Root->GetArrayField(TEXT("volumes")))
	{
		const TSharedPtr<FJsonObject> O = V->AsObject();
		FBWVolume& Vol = Volumes.AddDefaulted_GetRef();
		O->TryGetStringField(TEXT("bbl"), Vol.Bbl);
		O->TryGetStringField(TEXT("cls"), Vol.Cls);
		O->TryGetStringField(TEXT("deco"), Vol.Deco);
		O->TryGetNumberField(TEXT("year"), Vol.Year);
		Vol.Z0 = O->GetNumberField(TEXT("z0"));
		Vol.Z1 = O->GetNumberField(TEXT("z1"));
		O->TryGetBoolField(TEXT("crown"), Vol.bCrown);
		O->TryGetBoolField(TEXT("vacant"), Vol.bVacant);
		O->TryGetStringField(TEXT("fam"), Vol.Fam);
		const TArray<TSharedPtr<FJsonValue>>* Tint;
		if (O->TryGetArrayField(TEXT("tint"), Tint) && Tint->Num() == 3)
			Vol.Tint = FLinearColor((float)(*Tint)[0]->AsNumber(), (float)(*Tint)[1]->AsNumber(), (float)(*Tint)[2]->AsNumber());
		Vol.Ring = ReadRing(O);
	}

	for (const TSharedPtr<FJsonValue>& V : Root->GetArrayField(TEXT("water"))) Water.Add(ReadFlat(V->AsArray()));

	// layer order is the exporter's; JSON objects keep insertion order
	const TSharedPtr<FJsonObject> G = Root->GetObjectField(TEXT("ground"));
	for (const TPair<FString, TSharedPtr<FJsonValue>>& L : G->Values)
	{
		TArray<TArray<FVector2D>>& Rings = Ground.Emplace_GetRef(L.Key, TArray<TArray<FVector2D>>()).Value;
		for (const TSharedPtr<FJsonValue>& R : L.Value->AsArray()) Rings.Add(ReadFlat(R->AsArray()));
	}

	Trees = ReadFlat(Root->GetArrayField(TEXT("trees")));
	const TSharedPtr<FJsonObject>* Marks;
	if (Root->TryGetObjectField(TEXT("markings"), Marks))
	{
		for (const TSharedPtr<FJsonValue>& V : (*Marks)->GetArrayField(TEXT("centerlines")))
		{
			const TSharedPtr<FJsonObject> O = V->AsObject();
			FBWCenterline& Cl = Centerlines.AddDefaulted_GetRef();
			O->TryGetNumberField(TEXT("w"), Cl.Width);
			O->TryGetNumberField(TEXT("mk"), Cl.Mark);
			O->TryGetStringField(TEXT("cls"), Cl.Cls);
			Cl.Line = ReadFlat(O->GetArrayField(TEXT("line")));
		}
		for (const TSharedPtr<FJsonValue>& V : (*Marks)->GetArrayField(TEXT("zebras"))) Zebras.Add(ReadFlat(V->AsArray()));
	}
	for (const TSharedPtr<FJsonValue>& V : Root->GetArrayField(TEXT("labels")))
	{
		const TSharedPtr<FJsonObject> O = V->AsObject();
		const TArray<TSharedPtr<FJsonValue>>& At = O->GetArrayField(TEXT("at"));
		Labels.Add({ O->GetStringField(TEXT("name")), O->GetStringField(TEXT("kind")), FVector2D(At[0]->AsNumber(), At[1]->AsNumber()) });
	}

	UE_LOG(LogBWCity, Display, TEXT("%s (%s): %d parcels, %d volumes, %d trees"), *Name, *Size, Parcels.Num(), Volumes.Num(), Trees.Num());
	return true;
}

const FBWParcel* FBWCity::FindParcel(const FString& Bbl) const
{
	const int32* I = ParcelByBbl.Find(Bbl);
	return I ? &Parcels[*I] : nullptr;
}
