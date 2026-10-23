export type AiError = Readonly<{ code: "AI_PROVIDER_UNAVAILABLE" | "INVALID_AI_RESPONSE" | "DEADLINE_EXCEEDED"; message: string }>;

export const invalidAiResponse = (message: string): AiError => ({ code: "INVALID_AI_RESPONSE", message });
