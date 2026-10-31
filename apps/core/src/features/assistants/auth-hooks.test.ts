import { describe, expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import type { UserId } from "@shared/identity";
import { log } from "@core/src/shared/infrastructure/logger";
import { createHasActiveConnection, createPasswordResetCleanup } from "@core/src/features/assistants/auth-hooks";
import { clientId, ownerAccess, resolved, storedConnection } from "@core/src/features/assistants/application/assistant-fixtures";

describe("active connection check", () => {
  const ready = { status: "ready" as const, company: { id: ownerAccess.companyId } };
  const day = 24 * 60 * 60 * 1000;
  const build = (now: Date, access: unknown = ready) => createHasActiveConnection({
    loadAccess: async () => ok(access as never),
    findConnection: () => resolved(storedConnection({ authorizedAt: new Date("2026-10-01T10:00:00.000Z") })),
    now: () => now,
    inactivityDays: 30,
  });

  test("reads the injected clock: the same connection is active inside the window and ended after it", async () => {
    const authorizedAt = new Date("2026-10-01T10:00:00.000Z");
    expect(await build(new Date(authorizedAt.getTime() + 29 * day))(ownerAccess.userId, clientId)).toEqual({ success: true, data: true });
    expect(await build(new Date(authorizedAt.getTime() + 31 * day))(ownerAccess.userId, clientId)).toEqual({ success: true, data: false });
  });

  test("an account without a ready store has no active connection and the connection is not looked up", async () => {
    const findConnection = vi.fn(() => resolved(null));
    const check = createHasActiveConnection({ loadAccess: async () => ok({ status: "company_required", company: null }), findConnection, now: () => new Date(), inactivityDays: 30 });
    expect(await check(ownerAccess.userId, clientId)).toEqual({ success: true, data: false });
    expect(findConnection).not.toHaveBeenCalled();
  });

  test("answers unavailable when the account cannot be loaded", async () => {
    const check = createHasActiveConnection({ loadAccess: async () => err({ code: "PERSISTENCE_UNAVAILABLE", message: "down" }), findConnection: () => resolved(null), now: () => new Date(), inactivityDays: 30 });
    expect(await check(ownerAccess.userId, clientId)).toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
  });
});

describe("password reset cleanup", () => {
  test("a failed password reset cleanup is logged and the reset still completes", async () => {
    const logged = vi.spyOn(log, "error").mockImplementation(() => undefined);
    try {
      const cleanup = createPasswordResetCleanup(async () => err({ code: "PERSISTENCE_UNAVAILABLE", message: "down" }));
      await expect(cleanup({ user: { id: "user-1" } })).resolves.toBeUndefined();
      expect(logged).toHaveBeenCalledTimes(1);
      expect(logged).toHaveBeenCalledWith(expect.objectContaining({ event: "assistant_password_reset_cleanup_failed", userId: "user-1", errorCode: "PERSISTENCE_UNAVAILABLE" }), "assistant_password_reset_cleanup_failed");
    } finally { logged.mockRestore(); }
  });

  test("an unexpected error is logged once and never reaches Better Auth", async () => {
    const logged = vi.spyOn(log, "error").mockImplementation(() => undefined);
    try {
      const cleanup = createPasswordResetCleanup(async () => { throw new Error("boom"); });
      await expect(cleanup({ user: { id: "user-1" } })).resolves.toBeUndefined();
      expect(logged).toHaveBeenCalledWith(expect.objectContaining({ errorCode: "UNEXPECTED_ERROR" }), "assistant_password_reset_cleanup_failed");
    } finally { logged.mockRestore(); }
  });

  test("ends the account's connections without logging an error on success", async () => {
    const logged = vi.spyOn(log, "error").mockImplementation(() => undefined);
    const end = vi.fn(async () => ok(2));
    try {
      await createPasswordResetCleanup(end)({ user: { id: "user-1" } });
      expect(end).toHaveBeenCalledWith({ userId: "user-1" as UserId });
      expect(logged).not.toHaveBeenCalled();
    } finally { logged.mockRestore(); }
  });
});
