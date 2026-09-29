// The outside-AI plug-in: wire protocol, providers, controller, mock players.
export { AI_SYSTEM_PROMPT, briefMessage, parseAiReply, type AiReply } from "./protocol";
export { callProvider, ANTHROPIC_MODELS, DEFAULTS as AI_PROVIDER_DEFAULTS, type AiProviderConfig, type ProviderKind } from "./providers";
export { runAiTurn, aiTurnDue, type AiControllerOptions } from "./controller";
export { mockPlayers, type MockStyle } from "./mock";
