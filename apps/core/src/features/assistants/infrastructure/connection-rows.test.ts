import { describe, expect, test, vi } from "vitest";
import { log } from "@core/src/shared/infrastructure/logger";
import { parseAssistantConnectionRow } from "@core/src/features/assistants/infrastructure/connection-rows";

const row = {
  id: "6c0f5d2e-6a63-4a38-9f07-3b8f7a1c0001",
  companyId: "6c0f5d2e-6a63-4a38-9f07-3b8f7a1c0002",
  authorizedByUserId: "user-1",
  oauthClientId: "client-1",
  agentName: "Claude",
  returnKind: "web",
  returnDomain: "claude.ai",
  scopes: ["orders:read"],
  authorizedAt: new Date("2026-10-30T12:00:00.000Z"),
  lastUsedAt: null,
};

describe("parseAssistantConnectionRow", () => {
  test("reads a stored web connection", () => {
    const parsed = parseAssistantConnectionRow(row);
    expect(parsed).toMatchObject({ success: true, data: { agentName: "Claude", returnTarget: { kind: "web", domain: "claude.ai" }, scopes: ["orders:read"], lastUsedAt: null } });
  });

  test("reads a stored this-device connection without a name", () => {
    const parsed = parseAssistantConnectionRow({ ...row, agentName: null, returnKind: "this_device", returnDomain: null });
    expect(parsed).toMatchObject({ success: true, data: { agentName: null, returnTarget: { kind: "this_device" } } });
  });

  test("answers invalid stored data and logs once when the row breaks the schema", () => {
    const diagnostic = vi.spyOn(log, "error").mockImplementation(() => undefined);
    try {
      for (const broken of [
        { ...row, scopes: [] },
        { ...row, scopes: ["orders:write"] },
        { ...row, returnKind: "web", returnDomain: null },
        { ...row, returnKind: "this_device", returnDomain: "claude.ai" },
        { ...row, agentName: "" },
        { ...row, extra: true },
      ]) {
        expect(parseAssistantConnectionRow(broken)).toMatchObject({ success: false, error: { code: "INVALID_STORED_DATA" } });
      }
      expect(diagnostic).toHaveBeenCalledTimes(6);
    } finally { diagnostic.mockRestore(); }
  });
});
