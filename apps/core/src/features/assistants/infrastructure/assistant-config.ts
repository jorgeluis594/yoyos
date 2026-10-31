import { z } from "zod";

// Initial values from the technical design (section 2); every one is adjustable through the environment.
const assistantEnvSchema = z.object({
  ASSISTANT_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  ASSISTANT_REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(90 * 24 * 60 * 60),
  ASSISTANT_REFRESH_REUSE_SECONDS: z.coerce.number().int().nonnegative().default(10),
  ASSISTANT_AUTHORIZATION_REQUEST_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  ASSISTANT_CONNECTION_INACTIVITY_DAYS: z.coerce.number().int().positive().default(90),
  ASSISTANT_REGISTER_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(5),
  ASSISTANT_AUTHORIZE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(30),
  ASSISTANT_TOKEN_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
  ASSISTANT_TOOL_CALL_LIMIT: z.coerce.number().int().positive().default(60),
  ASSISTANT_REQUEST_LIMIT: z.coerce.number().int().positive().default(300),
  // Addresses or CIDR ranges of the reverse proxies in front of core, used to find the real client IP in x-forwarded-for.
  ASSISTANT_TRUSTED_PROXIES: z.string().default("127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,fc00::/7"),
});

export type AssistantConfig = Readonly<{
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  refreshReuseSeconds: number;
  authorizationRequestTtlSeconds: number;
  connectionInactivityDays: number;
  registerLimitPerMinute: number;
  authorizeLimitPerMinute: number;
  tokenLimitPerMinute: number;
  toolCallLimitPerMinute: number;
  requestLimitPerMinute: number;
  trustedProxies: readonly string[];
}>;

export function parseAssistantConfig(env: Readonly<Record<string, string | undefined>>): AssistantConfig {
  const parsed = assistantEnvSchema.parse(Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined && value !== "")));
  return {
    accessTokenTtlSeconds: parsed.ASSISTANT_ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenTtlSeconds: parsed.ASSISTANT_REFRESH_TOKEN_TTL_SECONDS,
    refreshReuseSeconds: parsed.ASSISTANT_REFRESH_REUSE_SECONDS,
    authorizationRequestTtlSeconds: parsed.ASSISTANT_AUTHORIZATION_REQUEST_TTL_SECONDS,
    connectionInactivityDays: parsed.ASSISTANT_CONNECTION_INACTIVITY_DAYS,
    registerLimitPerMinute: parsed.ASSISTANT_REGISTER_LIMIT_PER_MINUTE,
    authorizeLimitPerMinute: parsed.ASSISTANT_AUTHORIZE_LIMIT_PER_MINUTE,
    tokenLimitPerMinute: parsed.ASSISTANT_TOKEN_LIMIT_PER_MINUTE,
    toolCallLimitPerMinute: parsed.ASSISTANT_TOOL_CALL_LIMIT,
    requestLimitPerMinute: parsed.ASSISTANT_REQUEST_LIMIT,
    trustedProxies: parsed.ASSISTANT_TRUSTED_PROXIES.split(",").map((entry) => entry.trim()).filter((entry) => entry !== ""),
  };
}

export const assistantConfig: AssistantConfig = parseAssistantConfig(process.env);
