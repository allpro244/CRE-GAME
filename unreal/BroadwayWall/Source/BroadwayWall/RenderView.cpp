#include "RenderView.h"

#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

TArray<FBWRenderTier> BWReadTiers(const TSharedPtr<FJsonObject>& O)
{
	TArray<FBWRenderTier> Out;
	const TArray<TSharedPtr<FJsonValue>>* Tiers;
	if (O && O->TryGetArrayField(TEXT("tiers"), Tiers))
		for (const TSharedPtr<FJsonValue>& TV : *Tiers)
		{
			const TSharedPtr<FJsonObject> T = TV->AsObject();
			if (!T) continue;
			FBWRenderTier& Tier = Out.AddDefaulted_GetRef();
			const TArray<TSharedPtr<FJsonValue>>& R2 = T->GetArrayField(TEXT("ring"));
			for (int32 k = 0; k + 1 < R2.Num(); k += 2) Tier.Ring.Emplace(R2[k]->AsNumber(), R2[k + 1]->AsNumber());
			Tier.Z0 = T->GetNumberField(TEXT("z0"));
			Tier.Z1 = T->GetNumberField(TEXT("z1"));
		}
	return Out;
}

bool FBWRenderView::Parse(const FString& Json)
{
	TSharedPtr<FJsonObject> R;
	if (!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Json), R) || !R.IsValid()) return false;
	if (R->GetStringField(TEXT("format")) != TEXT("bw-render/1")) return false;
	Month = (int32)R->GetNumberField(TEXT("month"));
	Year = (int32)R->GetNumberField(TEXT("year"));
	R->TryGetStringField(TEXT("phase"), Phase);

	Lots.Reset();
	for (const TSharedPtr<FJsonValue>& V : R->GetArrayField(TEXT("lots")))
	{
		const TSharedPtr<FJsonObject> O = V->AsObject();
		FBWRenderLot& L = Lots.AddDefaulted_GetRef();
		L.Bbl = O->GetStringField(TEXT("bbl"));
		L.Cls = O->GetStringField(TEXT("cls"));
		L.Floors = (int32)O->GetNumberField(TEXT("floors"));
		L.HeightM = O->GetNumberField(TEXT("heightM"));
		L.bConstruction = O->GetBoolField(TEXT("construction"));
		L.Progress = O->GetNumberField(TEXT("progress"));
		O->TryGetNumberField(TEXT("cov"), L.Cov);
		L.Year = (int32)O->GetNumberField(TEXT("year"));
		O->TryGetBoolField(TEXT("fresh"), L.bFresh);
		O->TryGetBoolField(TEXT("shops"), L.bShops);
		O->TryGetStringField(TEXT("facade"), L.Facade);
		L.Look = BWReadLook(O, TEXT("look"));
		O->TryGetStringField(TEXT("form"), L.Form);
		O->TryGetStringField(TEXT("deco"), L.Deco);
		L.Tiers = BWReadTiers(O);
	}

	Owners.Reset();
	for (const TSharedPtr<FJsonValue>& V : R->GetArrayField(TEXT("owners")))
	{
		const TSharedPtr<FJsonObject> O = V->AsObject();
		FBWRenderOwner& W = Owners.AddDefaulted_GetRef();
		W.Bbl = O->GetStringField(TEXT("bbl"));
		W.Owner = O->GetStringField(TEXT("owner"));
		O->TryGetStringField(TEXT("firm"), W.Firm);
		O->TryGetBoolField(TEXT("listed"), W.bListed);
		O->TryGetNumberField(TEXT("distress"), W.Distress);
	}

	Merged.Reset();
	for (const TPair<FString, TSharedPtr<FJsonValue>>& P : R->GetObjectField(TEXT("merged"))->Values) Merged.Add(P.Key, P.Value->AsString());

	Events.Reset();
	for (const TSharedPtr<FJsonValue>& V : R->GetArrayField(TEXT("events")))
	{
		const TSharedPtr<FJsonObject> O = V->AsObject();
		Events.Add({ (int32)O->GetNumberField(TEXT("m")), O->GetStringField(TEXT("bbl")), O->GetStringField(TEXT("kind")) });
	}
	return true;
}
