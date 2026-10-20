#include "PlayHost.h"

#include "BWGame.h"
#include "HttpPath.h"
#include "HttpServerModule.h"
#include "HttpServerRequest.h"
#include "HttpServerResponse.h"
#include "IHttpRouter.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"

DEFINE_LOG_CATEGORY_STATIC(LogBWPlay, Log, All);

void UBWBridge::City(const FString& Json) { if (Game.IsValid()) Game->OnPageCity(Json); }
void UBWBridge::View(const FString& Json) { if (Game.IsValid()) Game->OnPageView(Json); }
void UBWBridge::Select(const FString& Bbl) { if (Game.IsValid()) Game->OnPageSelect(Bbl); }
void UBWBridge::Input(const FString& Json) { if (Game.IsValid()) Game->OnPageInput(Json); }

bool FBWWebServer::Start(const FString& Root, uint32 Port)
{
	TSharedPtr<IHttpRouter> Router = FHttpServerModule::Get().GetHttpRouter(Port);
	if (!Router.IsValid()) { UE_LOG(LogBWPlay, Error, TEXT("no HTTP router on port %u"), Port); return false; }
	const FString Base = FPaths::ConvertRelativePathToFull(Root);
	// the router will not bind the root; the game lives under /game/
	Router->BindRoute(FHttpPath(TEXT("/game")), EHttpServerRequestVerbs::VERB_GET,
		FHttpRequestHandler::CreateLambda([Base](const FHttpServerRequest& Req, const FHttpResultCallback& Done)
		{
			FString Rel = Req.RelativePath.GetPath();
			Rel.RemoveFromStart(TEXT("/"));
			if (Rel.IsEmpty()) Rel = TEXT("broadway-and-wall.html");
			const FString File = FPaths::Combine(Base, Rel);
			TArray<uint8> Bytes;
			// stay inside the served folder
			if (!FPaths::IsUnderDirectory(FPaths::ConvertRelativePathToFull(File), Base) || !FFileHelper::LoadFileToArray(Bytes, *File))
			{
				Done(FHttpServerResponse::Error(EHttpServerResponseCodes::NotFound));
				return true;
			}
			const FString Ext = FPaths::GetExtension(File).ToLower();
			const FString Type = Ext == TEXT("html") ? TEXT("text/html; charset=utf-8") : Ext == TEXT("js") ? TEXT("text/javascript")
				: Ext == TEXT("json") ? TEXT("application/json") : Ext == TEXT("png") ? TEXT("image/png") : TEXT("application/octet-stream");
			Done(FHttpServerResponse::Create(MoveTemp(Bytes), Type));
			return true;
		}));
	FHttpServerModule::Get().StartAllListeners();
	UE_LOG(LogBWPlay, Display, TEXT("serving %s on http://127.0.0.1:%u/game/"), *Base, Port);
	return true;
}
