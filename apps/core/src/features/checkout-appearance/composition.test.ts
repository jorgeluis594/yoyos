import { afterEach, describe, expect, test, vi } from "vitest";
import { ok } from "@shared/functional";
import { log } from "@core/src/shared/infrastructure/logger";
import { parseCompanyId, parseUserId } from "@core/src/features/checkout-appearance/domain/checkout-appearance";

const tenant = "00000000-0000-4000-8000-000000000001";
vi.mock("@core/src/shared/infrastructure/persistance", () => ({
  getCompanyId: () => tenant, withTenantIsolation: (_company: string, work: () => unknown) => work(),
}));
vi.mock("@core/src/features/checkout-appearance/infrastructure/checkout-appearance-repository", () => ({
  loadCheckoutAppearance: vi.fn(), loadCompanyName: vi.fn(), persistCheckoutAppearance: async () => ok(null),
}));
vi.mock("@core/src/shared/images", () => ({ findAvailablePublicImage: async () => ok({ id: "image" }), resolvePublicImage: vi.fn() }));
vi.mock("@core/src/features/companies", () => ({ companyPaymentSettings: { get: vi.fn() } }));

import { checkoutAppearance } from "@core/src/features/checkout-appearance/composition";

const companyResult = parseCompanyId(tenant);
const userResult = parseUserId("user-1");
if (!companyResult.success || !userResult.success) throw new Error("Invalid test ids");
const companyId = companyResult.data;
const userId = userResult.data;
const logoImageId = "00000000-0000-4000-8000-0000000000aa";

afterEach(() => vi.restoreAllMocks());

describe("save checkout appearance", () => {
  test("logs checkout_appearance_saved with the logo when the appearance has one", async () => {
    const info = vi.spyOn(log, "info").mockImplementation(() => {});
    const saved = await checkoutAppearance.save(companyId, userId, { logoImageId, brandColor: "forest", background: "brand_tint" });
    expect(saved.success).toBe(true);
    expect(info).toHaveBeenCalledWith({ event: "checkout_appearance_saved", companyId, userId, logoImageId, hasLogo: true,
      brandColor: "forest", background: "brand_tint", isDefault: false }, "checkout_appearance_saved");
  });

  test("logs checkout_appearance_saved without logoImageId when there is no logo", async () => {
    const info = vi.spyOn(log, "info").mockImplementation(() => {});
    await checkoutAppearance.save(companyId, userId, { logoImageId: null, brandColor: "yoyos", background: "neutral" });
    const payload = info.mock.calls[0][0];
    expect(payload).toMatchObject({ event: "checkout_appearance_saved", hasLogo: false, isDefault: true });
    expect(payload).not.toHaveProperty("logoImageId");
  });

  test("does not log the event when the appearance is invalid", async () => {
    const info = vi.spyOn(log, "info").mockImplementation(() => {});
    const saved = await checkoutAppearance.save(companyId, userId, { logoImageId: null, brandColor: "#ff0000", background: "white" });
    expect(saved).toMatchObject({ success: false, error: { code: "INVALID_CHECKOUT_APPEARANCE" } });
    expect(info).not.toHaveBeenCalled();
  });
});
