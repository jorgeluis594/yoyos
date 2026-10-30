import { expect, test } from "vitest";
import { parseAssistantConfig } from "@core/src/features/assistants/infrastructure/assistant-config";

test("uses the design's initial values when nothing is configured", () => {
  expect(parseAssistantConfig({})).toMatchObject({
    accessTokenTtlSeconds: 3600, refreshTokenTtlSeconds: 90 * 24 * 3600, refreshReuseSeconds: 10, authorizationRequestTtlSeconds: 600,
    connectionInactivityDays: 90, registerLimitPerMinute: 5, authorizeLimitPerMinute: 30, tokenLimitPerMinute: 300,
  });
});

test("reads overrides and treats empty values as unset", () => {
  const config = parseAssistantConfig({ ASSISTANT_ACCESS_TOKEN_TTL_SECONDS: "600", ASSISTANT_REFRESH_REUSE_SECONDS: "", ASSISTANT_TRUSTED_PROXIES: "10.0.0.1, 10.0.0.2" });
  expect(config.accessTokenTtlSeconds).toBe(600);
  expect(config.refreshReuseSeconds).toBe(10);
  expect(config.trustedProxies).toEqual(["10.0.0.1", "10.0.0.2"]);
});

test("refuses a value that is not a positive number", () => {
  expect(() => parseAssistantConfig({ ASSISTANT_ACCESS_TOKEN_TTL_SECONDS: "0" })).toThrow();
  expect(() => parseAssistantConfig({ ASSISTANT_TOKEN_LIMIT_PER_MINUTE: "many" })).toThrow();
});
