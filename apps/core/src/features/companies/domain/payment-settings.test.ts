import { expect, test } from "vitest";
import { offeredPaymentSettings, parsePaymentSettingsInput, parseStoredPaymentSettings, type CompanyPaymentSettings, type ImageId } from "@core/src/features/companies/domain/payment-settings";

const imageId = "00000000-0000-4000-8000-000000000001" as ImageId;
const wallet = { method: "digital_wallet", provider: "Yape", holder: "Ana", imageId };
const bank = { method: "bank_transfer", bank: "BCP", holder: "Ana", accountNumber: "00123", cci: null, imageId: null };
const storedWallet = { method: "digital_wallet", provider: "Yape", holder: "Ana", qr: { status: "verified", imageId } };

test("accepts one complete setting per method and preserves bank identifiers", () => {
  expect(parsePaymentSettingsInput([wallet, bank])).toMatchObject({ success: true, data: [wallet, bank] });
  expect(parsePaymentSettingsInput([{ ...bank, cci: "000456" }])).toMatchObject({ success: true,
    data: [{ accountNumber: "00123", cci: "000456" }] });
  expect(parsePaymentSettingsInput([{ ...bank, accountNumber: null, cci: "000456" }]).success).toBe(true);
  expect(parsePaymentSettingsInput([])).toMatchObject({ success: true, data: [] });
});

test("rejects missing fields, absent bank identifiers and duplicate methods", () => {
  for (const value of [
    [wallet, wallet], [{ ...wallet, holder: " " }], [{ ...wallet, provider: "" }],
    [{ ...bank, accountNumber: null }], [{ ...bank, accountNumber: " " }], [{ ...bank, bank: "" }],
    [{ ...wallet, phone: "123" }], [{ ...wallet, imageId: "invalid" }],
  ]) expect(parsePaymentSettingsInput(value)).toMatchObject({ success: false, error: { code: "INVALID_PAYMENT_SETTINGS" } });
});

test("rejects a wallet input without imageId", () => {
  for (const value of [[{ ...wallet, imageId: null }], [{ method: "digital_wallet", provider: "Yape", holder: "Ana" }]])
    expect(parsePaymentSettingsInput(value)).toMatchObject({ success: false, error: { code: "INVALID_PAYMENT_SETTINGS" } });
});

test("never lets a client choose the qr status", () => {
  expect(parsePaymentSettingsInput([{ ...wallet, qr: { status: "verified", imageId } }]).success).toBe(false);
});

test("parses a stored verified wallet with its qr image", () => {
  expect(parseStoredPaymentSettings([storedWallet, bank])).toMatchObject({ success: true, data: [storedWallet, bank] });
});

test("parses a wallet saved before this version as unchecked keeping its image or no image", () => {
  const before = { method: "digital_wallet", provider: "Yape", holder: "Ana" };
  expect(parseStoredPaymentSettings([{ ...before, imageId }])).toMatchObject({ success: true,
    data: [{ ...before, qr: { status: "unchecked", imageId } }] });
  expect(parseStoredPaymentSettings([{ ...before, imageId: null }])).toMatchObject({ success: true,
    data: [{ ...before, qr: { status: "unchecked", imageId: null } }] });
});

test("refuses a stored wallet in any other shape as invalid stored data", () => {
  for (const value of [
    [{ ...storedWallet, qr: { status: "unchecked", imageId } }],
    [{ ...storedWallet, qr: { status: "verified", imageId: null } }],
    [{ ...storedWallet, qr: { status: "verified" } }],
    [{ ...storedWallet, imageId }],
    [{ method: "digital_wallet", provider: "Yape", holder: "Ana" }],
    [{ method: "unknown" }],
  ]) expect(parseStoredPaymentSettings(value)).toMatchObject({ success: false, error: { code: "INVALID_PAYMENT_SETTINGS" } });
});

test("offers a wallet only when its qr is verified and always offers bank transfer", () => {
  const stored = parseStoredPaymentSettings([storedWallet, bank]);
  expect(stored.success && offeredPaymentSettings(stored.data)).toEqual([
    { method: "digital_wallet", provider: "Yape", holder: "Ana", imageId }, bank]);
  const unchecked: CompanyPaymentSettings[] = [
    { method: "digital_wallet", provider: "Yape", holder: "Ana", qr: { status: "unchecked", imageId } },
    { ...bank, accountNumber: "00123" } as CompanyPaymentSettings,
  ];
  expect(offeredPaymentSettings(unchecked)).toEqual([bank]);
});
