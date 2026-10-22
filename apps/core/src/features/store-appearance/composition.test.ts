import { afterEach, describe, expect, test, vi } from "vitest";
import { ok } from "@shared/functional";
import { log } from "@core/src/shared/infrastructure/logger";
import { parseCompanyId, parseUserId } from "@core/src/features/store-appearance/domain/store-appearance";

const tenant = "00000000-0000-4000-8000-000000000001";
vi.mock("@core/src/shared/infrastructure/persistance", () => ({
  getCompanyId: () => tenant, withTenantIsolation: (_company: string, work: () => unknown) => work(),
}));
vi.mock("@core/src/features/store-appearance/infrastructure/store-appearance-repository", () => ({
  loadStoreAppearance: vi.fn(), loadCompanyName: vi.fn(), persistStoreAppearance: async () => ok(null),
}));
vi.mock("@core/src/shared/images", () => ({ findAvailablePublicImage: async () => ok({ id: "image" }), resolvePublicImage: vi.fn() }));
vi.mock("@core/src/features/companies", () => ({ companyPaymentSettings: { get: vi.fn() } }));

import { storeAppearance } from "@core/src/features/store-appearance/composition";

const companyResult = parseCompanyId(tenant);
const userResult = parseUserId("user-1");
if (!companyResult.success || !userResult.success) throw new Error("Invalid test ids");
const companyId = companyResult.data;
const userId = userResult.data;
const logoImageId = "00000000-0000-4000-8000-0000000000aa";

afterEach(() => vi.restoreAllMocks());

describe("save checkout appearance", () => {
  test("logs store_appearance_saved with the theme and the logo when the appearance has one", async () => {
    const info = vi.spyOn(log, "info").mockImplementation(() => {});
    const saved = await storeAppearance.save(companyId, userId, { logoImageId, theme: "suave" });
    expect(saved.success).toBe(true);
    expect(info).toHaveBeenCalledWith({ event: "store_appearance_saved", companyId, userId, logoImageId, hasLogo: true,
      theme: "suave", isDefault: false }, "store_appearance_saved");
  });

  test("logs store_appearance_saved without logoImageId when there is no logo", async () => {
    const info = vi.spyOn(log, "info").mockImplementation(() => {});
    await storeAppearance.save(companyId, userId, { logoImageId: null, theme: "classic" });
    const payload = info.mock.calls[0][0];
    expect(payload).toMatchObject({ event: "store_appearance_saved", hasLogo: false, isDefault: true });
    expect(payload).not.toHaveProperty("logoImageId");
  });

  test("does not log the event when the appearance is invalid", async () => {
    const info = vi.spyOn(log, "info").mockImplementation(() => {});
    const saved = await storeAppearance.save(companyId, userId, { logoImageId: null, theme: "neon" });
    expect(saved).toMatchObject({ success: false, error: { code: "INVALID_STORE_APPEARANCE" } });
    expect(info).not.toHaveBeenCalled();
  });
});
