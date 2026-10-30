import { describe, expect, test } from "vitest";
import {
  isAllowedRedirectUri, isConnectionActive, parseAgentName, returnTargetOf, sameMinute,
  type AssistantConnectionId, type ConnectionWithPasswordChange, type OAuthClientId,
} from "@core/src/features/assistants/domain/assistant-connection";
import type { CompanyId, UserId } from "@shared/identity";

const now = new Date("2026-10-30T12:00:00.000Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

function connection(overrides: Partial<ConnectionWithPasswordChange> = {}): ConnectionWithPasswordChange {
  return {
    id: "6c0f5d2e-6a63-4a38-9f07-3b8f7a1c0001" as AssistantConnectionId,
    companyId: "6c0f5d2e-6a63-4a38-9f07-3b8f7a1c0002" as CompanyId,
    authorizedByUserId: "user-1" as UserId,
    oauthClientId: "client-1" as OAuthClientId,
    agentName: null,
    returnTarget: { kind: "this_device" },
    scopes: ["orders:read"],
    authorizedAt: daysAgo(100),
    lastUsedAt: daysAgo(1),
    passwordChangedAt: null,
    ...overrides,
  };
}

describe("isConnectionActive", () => {
  test("treats a connection used 89 days ago as active and one used 90 days ago as ended", () => {
    expect(isConnectionActive(connection({ lastUsedAt: daysAgo(89) }), now, 90)).toBe(true);
    expect(isConnectionActive(connection({ lastUsedAt: daysAgo(90) }), now, 90)).toBe(false);
  });

  test("counts inactivity from authorization when the connection was never used", () => {
    expect(isConnectionActive(connection({ lastUsedAt: null, authorizedAt: daysAgo(89) }), now, 90)).toBe(true);
    expect(isConnectionActive(connection({ lastUsedAt: null, authorizedAt: daysAgo(90) }), now, 90)).toBe(false);
  });

  test("ends a connection authorized before the account's last password change", () => {
    const authorizedAt = daysAgo(10);
    expect(isConnectionActive(connection({ authorizedAt, lastUsedAt: null, passwordChangedAt: daysAgo(11) }), now, 90)).toBe(true);
    expect(isConnectionActive(connection({ authorizedAt, lastUsedAt: null, passwordChangedAt: daysAgo(9) }), now, 90)).toBe(false);
    expect(isConnectionActive(connection({ authorizedAt, lastUsedAt: null, passwordChangedAt: authorizedAt }), now, 90)).toBe(false);
  });
});

describe("parseAgentName", () => {
  test("rejects an agent name made only of spaces or longer than 80 characters", () => {
    expect(parseAgentName("   ")).toBeNull();
    expect(parseAgentName(undefined)).toBeNull();
    expect(parseAgentName("a".repeat(81))).toBeNull();
    expect(parseAgentName("a".repeat(80))).toBe("a".repeat(80));
  });

  test("measures the name in code points like the database check", () => {
    expect(parseAgentName("😀".repeat(80))).toBe("😀".repeat(80));
    expect(parseAgentName("😀".repeat(81))).toBeNull();
  });

  test("trims the name and removes control characters", () => {
    expect(parseAgentName("  Cla\u0000ude\n ")).toBe("Claude");
  });
});

describe("redirect URIs", () => {
  test("accepts https and loopback http redirect URIs and refuses custom schemes, other http hosts, userinfo and fragments", () => {
    expect(isAllowedRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(isAllowedRedirectUri("http://127.0.0.1:8123/callback")).toBe(true);
    expect(isAllowedRedirectUri("http://[::1]:8123/callback")).toBe(true);
    expect(isAllowedRedirectUri("http://localhost/callback")).toBe(true);
    expect(isAllowedRedirectUri("myapp://callback")).toBe(false);
    expect(isAllowedRedirectUri("http://example.com/callback")).toBe(false);
    expect(isAllowedRedirectUri("https://localhost/callback")).toBe(false);
    expect(isAllowedRedirectUri("https://127.0.0.1/callback")).toBe(false);
    expect(isAllowedRedirectUri("https://user:pass@claude.ai/callback")).toBe(false);
    expect(isAllowedRedirectUri("https://claude.ai/callback#fragment")).toBe(false);
    expect(isAllowedRedirectUri("not a url")).toBe(false);
  });

  test("returns the domain for an https redirect and this device for a loopback redirect", () => {
    expect(returnTargetOf("https://chatgpt.com/connector/oauth/abc")).toEqual({ kind: "web", domain: "chatgpt.com" });
    expect(returnTargetOf("http://127.0.0.1:9000/cb")).toEqual({ kind: "this_device" });
    expect(returnTargetOf("http://localhost/cb")).toEqual({ kind: "this_device" });
  });

  test("returns no target for a redirect that is not allowed instead of claiming this device", () => {
    for (const uri of ["myapp://callback", "evil://chatgpt.com/cb", "not a url", "http://example.com/cb", "https://localhost/cb", "https://user:pass@claude.ai/cb", "https://claude.ai/cb#x"]) {
      expect(returnTargetOf(uri)).toBeNull();
    }
  });

  test("treats the whole 127.0.0.0/8 block, IPv4-mapped loopback and a trailing-dot localhost as loopback", () => {
    for (const uri of ["http://127.0.0.2:8000/cb", "http://127.255.255.254/cb", "http://[::ffff:127.0.0.1]/cb", "http://localhost./cb"]) {
      expect(isAllowedRedirectUri(uri)).toBe(true);
      expect(returnTargetOf(uri)).toEqual({ kind: "this_device" });
    }
    for (const uri of ["https://127.0.0.2/cb", "https://[::ffff:127.0.0.1]/cb", "https://localhost./cb"]) expect(isAllowedRedirectUri(uri)).toBe(false);
    expect(isAllowedRedirectUri("http://128.0.0.1/cb")).toBe(false);
    expect(isAllowedRedirectUri("http://[::ffff:8.8.8.8]/cb")).toBe(false);
  });
});

describe("sameMinute", () => {
  test("is true only inside the same clock minute", () => {
    expect(sameMinute(new Date("2026-10-30T12:00:00.000Z"), new Date("2026-10-30T12:00:59.999Z"))).toBe(true);
    expect(sameMinute(new Date("2026-10-30T12:00:59.999Z"), new Date("2026-10-30T12:01:00.000Z"))).toBe(false);
    expect(sameMinute(new Date("2026-10-30T12:00:00.000Z"), new Date("2026-10-30T13:00:00.000Z"))).toBe(false);
  });
});
