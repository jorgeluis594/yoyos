import { expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { checkPaymentQr, getOfferedPaymentSettings, getPaymentConfiguration, savePaymentSettings } from "@core/src/features/companies/application/payment-settings";
import type { CompanyId, CompanyPaymentSettings, ImageId, QrCheckFailure } from "@core/src/features/companies/domain/payment-settings";

const company = "company" as CompanyId;
const imageId = "00000000-0000-4000-8000-000000000001" as ImageId;
const otherImageId = "00000000-0000-4000-8000-000000000002" as ImageId;
const wallet = { method: "digital_wallet", provider: "Yape", holder: "Ana", imageId } as const;
const bankInput = { method: "bank_transfer", bank: "BCP", holder: "Ana", accountNumber: "00123", cci: null, imageId: null } as const;
const verified = (id: ImageId): CompanyPaymentSettings => ({ method: "digital_wallet", provider: "Yape", holder: "Ana", qr: { status: "verified", imageId: id } });
const unchecked = (id: ImageId | null): CompanyPaymentSettings => ({ method: "digital_wallet", provider: "Yape", holder: "Ana", qr: { status: "unchecked", imageId: id } });

function setup(stored: readonly CompanyPaymentSettings[] = [], detect: Result<"qr_found" | "no_qr", QrCheckFailure> = ok("qr_found")) {
  const save = vi.fn<(companyId: string, settings: readonly CompanyPaymentSettings[]) => Promise<Result<null, never>>>(async () => ok(null));
  const detectQrCode = vi.fn(async () => detect);
  const deps = {
    load: async () => ok(stored),
    save,
    imageAvailable: async (_companyId: string, id: ImageId) => ok(id !== "00000000-0000-4000-8000-0000000000ff"),
    detectQrCode,
  };
  return { deps, save, detectQrCode };
}

test("saves an offered wallet as verified when its image holds a qr", async () => {
  const { deps, save, detectQrCode } = setup();
  const result = await savePaymentSettings(company, [wallet, bankInput], deps);
  expect(result).toEqual(ok([verified(imageId), bankInput]));
  expect(save).toHaveBeenCalledWith(company, [verified(imageId), bankInput]);
  expect(detectQrCode).toHaveBeenCalledWith(imageId, { companyId: company, stage: "save" });
});

test("rejects saving a wallet whose image holds no qr and saves nothing", async () => {
  const { deps, save } = setup([], ok("no_qr"));
  expect(await savePaymentSettings(company, [wallet], deps)).toMatchObject({ success: false, error: { code: "INVALID_PAYMENT_QR" } });
  expect(save).not.toHaveBeenCalled();
});

test("does not save when the qr check is unavailable for a new image", async () => {
  const { deps, save } = setup([verified(otherImageId)], err({ code: "QR_CHECK_UNAVAILABLE", message: "down" }));
  expect(await savePaymentSettings(company, [wallet], deps)).toMatchObject({ success: false, error: { code: "QR_CHECK_UNAVAILABLE" } });
  expect(save).not.toHaveBeenCalled();
});

test("keeps an unchanged verified wallet image without reading it again", async () => {
  const { deps, save, detectQrCode } = setup([verified(imageId)]);
  expect(await savePaymentSettings(company, [wallet], deps)).toEqual(ok([verified(imageId)]));
  expect(detectQrCode).not.toHaveBeenCalled();
  expect(save).toHaveBeenCalledTimes(1);
});

test("saves bank changes while the qr check is unavailable when the wallet image is unchanged", async () => {
  const { deps, save, detectQrCode } = setup([verified(imageId)], err({ code: "QR_CHECK_UNAVAILABLE", message: "down" }));
  const changed = { ...bankInput, accountNumber: "99999" };
  expect(await savePaymentSettings(company, [wallet, changed], deps)).toMatchObject({ success: true });
  expect(detectQrCode).not.toHaveBeenCalled();
  expect(save).toHaveBeenCalledWith(company, [verified(imageId), changed]);
});

test("reads the image of an unchecked wallet on save and stores it verified when it holds a qr", async () => {
  const { deps, save, detectQrCode } = setup([unchecked(imageId)]);
  expect(await savePaymentSettings(company, [wallet], deps)).toEqual(ok([verified(imageId)]));
  expect(detectQrCode).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledWith(company, [verified(imageId)]);
});

test("rejects saving an unchecked wallet whose image holds no qr and keeps it unchecked", async () => {
  const { deps, save } = setup([unchecked(imageId)], ok("no_qr"));
  expect(await savePaymentSettings(company, [wallet], deps)).toMatchObject({ success: false, error: { code: "INVALID_PAYMENT_QR" } });
  expect(save).not.toHaveBeenCalled();
});

test("rejects saving an unchecked wallet whose stored image no longer exists with INVALID_IMAGE", async () => {
  const missing = "00000000-0000-4000-8000-0000000000ff" as ImageId;
  const { deps, save, detectQrCode } = setup([unchecked(missing)]);
  expect(await savePaymentSettings(company, [{ ...wallet, imageId: missing }], deps)).toMatchObject({ success: false, error: { code: "INVALID_IMAGE" } });
  expect(detectQrCode).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});

test("refuses an image of the company that is unavailable before reading anything", async () => {
  const { deps, detectQrCode } = setup();
  const missing = "00000000-0000-4000-8000-0000000000ff" as ImageId;
  expect(await savePaymentSettings(company, [{ ...bankInput, imageId: missing }], deps)).toMatchObject({ success: false, error: { code: "INVALID_IMAGE" } });
  expect(await savePaymentSettings(company, [wallet, wallet], deps)).toMatchObject({ success: false, error: { code: "INVALID_PAYMENT_SETTINGS" } });
  expect(detectQrCode).not.toHaveBeenCalled();
});

test("reports a choose-time qr check as verified or not_a_qr without writing", async () => {
  const found = setup();
  expect(await checkPaymentQr(company, { imageId }, found.deps)).toEqual(ok("verified"));
  expect(found.detectQrCode).toHaveBeenCalledWith(imageId, { companyId: company, stage: "choose" });
  const none = setup([], ok("no_qr"));
  expect(await checkPaymentQr(company, { imageId }, none.deps)).toEqual(ok("not_a_qr"));
  const missing = "00000000-0000-4000-8000-0000000000ff" as ImageId;
  expect(await checkPaymentQr(company, { imageId: missing }, none.deps)).toMatchObject({ success: false, error: { code: "INVALID_IMAGE" } });
  expect(found.deps.save).not.toHaveBeenCalled();
  expect(none.save).not.toHaveBeenCalled();
});

test("reads offered settings and the full configuration", async () => {
  const { deps } = setup([unchecked(imageId), { ...bankInput }]);
  expect(await getOfferedPaymentSettings(company, deps)).toEqual(ok([bankInput]));
  expect(await getPaymentConfiguration(company, deps)).toEqual(ok([unchecked(imageId), bankInput]));
});
