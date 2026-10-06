import { expect, test } from "vitest";
import { parsePaymentSettings } from "@core/src/features/companies/domain/payment-settings";

const wallet = { method: "digital_wallet", provider: "Yape", holder: "Ana", imageId: null };
const bank = { method: "bank_transfer", bank: "BCP", holder: "Ana", accountNumber: "00123", cci: null, imageId: null };

test("accepts one complete setting per method and preserves bank identifiers", () => {
  expect(parsePaymentSettings([wallet, bank])).toMatchObject({ success: true, data: [wallet, bank] });
  expect(parsePaymentSettings([{ ...bank, cci: "000456" }])).toMatchObject({ success: true,
    data: [{ accountNumber: "00123", cci: "000456" }] });
  expect(parsePaymentSettings([{ ...bank, accountNumber: null, cci: "000456" }]).success).toBe(true);
  expect(parsePaymentSettings([])).toMatchObject({ success: true, data: [] });
});

test("rejects missing fields, absent bank identifiers and duplicate methods", () => {
  for (const value of [
    [wallet, wallet], [{ ...wallet, holder: " " }], [{ ...wallet, provider: "" }],
    [{ ...bank, accountNumber: null }], [{ ...bank, accountNumber: " " }], [{ ...bank, bank: "" }],
    [{ ...wallet, phone: "123" }], [{ ...wallet, imageId: "invalid" }],
  ]) expect(parsePaymentSettings(value)).toMatchObject({ success: false, error: { code: "INVALID_PAYMENT_SETTINGS" } });
});
