import { expect, test, vi } from "vitest";

const getJwks = vi.hoisted(() => vi.fn());
vi.mock("@core/src/shared/infrastructure/auth", () => ({ authIssuer: "http://localhost:3000", auth: { api: { getJwks } } }));
vi.mock("@core/src/shared/infrastructure/persistance", () => ({ systemPrisma: { session: { findFirst: vi.fn() } } }));
import { authenticateJwt } from "@core/src/shared/infrastructure/jwt-verifier";

test("public key lookup failure remains a service error", async () => {
  const diagnostic = vi.spyOn(console, "error").mockImplementation(() => undefined);
  getJwks.mockRejectedValueOnce(new Error("key store unavailable"));
  try {
    expect(await authenticateJwt("invalid.token.value")).toMatchObject({
      success: false, error: { code: "AUTH_SERVICE_UNAVAILABLE" },
    });
    expect(diagnostic).toHaveBeenCalledOnce();
  } finally { diagnostic.mockRestore(); }
});
