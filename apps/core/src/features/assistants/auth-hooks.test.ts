import { describe, expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import type { UserId } from "@shared/identity";
import { log } from "@core/src/shared/infrastructure/logger";
import { createPasswordResetCleanup } from "@core/src/features/assistants/auth-hooks";

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
