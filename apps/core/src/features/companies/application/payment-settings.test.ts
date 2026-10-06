import { expect, test } from "vitest";
import { ok } from "@shared/functional";
import { savePaymentSettings } from "@core/src/features/companies/application/payment-settings";

const imageId = "00000000-0000-4000-8000-000000000001";
const wallet = { method: "digital_wallet", provider: "Yape", holder: "Ana", imageId } as const;

test("validates settings and image ownership before replacing saved settings", async () => {
  let saved = 0;
  const deps = {
    load: async () => ok([]),
    save: async () => { saved++; return ok(null); },
    imageAvailable: async (_companyId: string, id: string) => ok(id !== imageId),
  };
  expect(await savePaymentSettings("company", [{ ...wallet, imageId: null }], deps)).toMatchObject({ success: true });
  expect(saved).toBe(1);
  expect(await savePaymentSettings("company", [wallet], deps)).toMatchObject({ success: false, error: { code: "INVALID_IMAGE" } });
  expect(await savePaymentSettings("company", [wallet, wallet], deps)).toMatchObject({ success: false, error: { code: "INVALID_PAYMENT_SETTINGS" } });
  expect(saved).toBe(1);
});
