import { expect, test } from "vitest";
import { canSaveWalletQr, walletQrAfterSave, walletQrRetry, walletQrWasNotAQr, type WalletQrState } from "@core/src/features/companies/presentation/wallet-qr-field";

const image = "00000000-0000-4000-8000-000000000001";
const can = (state: WalletQrState, offered = true) => canSaveWalletQr({ offered, state });

test("disables save while the offered wallet has no qr image", () => {
  expect(can({ status: "empty" })).toBe(false);
  expect(can({ status: "wrong_file", imageId: null })).toBe(false);
  expect(can({ status: "upload_failed", imageId: null })).toBe(false);
});

test("disables save while the chosen image is not a qr", () => {
  expect(can({ status: "not_a_qr", imageId: image })).toBe(false);
});

test("disables save while the image is uploading or the qr is being checked", () => {
  expect(can({ status: "uploading" })).toBe(false);
  expect(can({ status: "checking", imageId: image })).toBe(false);
});

test("keeps save enabled when the choose-time check could not run", () => {
  expect(can({ status: "check_unavailable", imageId: image })).toBe(true);
});

test("keeps save enabled for an unchecked wallet with image and disables it without image", () => {
  expect(can({ status: "unchecked", imageId: image })).toBe(true);
  expect(can({ status: "unchecked", imageId: null })).toBe(false);
});

test("keeps save enabled for a valid qr and for a failed upload that kept the previous image", () => {
  expect(can({ status: "valid", imageId: image, origin: "saved" })).toBe(true);
  expect(can({ status: "upload_failed", imageId: image })).toBe(true);
});

test("does not require a qr when the wallet is not offered", () => {
  for (const state of [{ status: "empty" }, { status: "not_a_qr", imageId: image }, { status: "checking", imageId: image }] as const)
    expect(can(state, false)).toBe(true);
});

test("keeps blocking the save when a failed replacement leaves a previous image that was not a qr", () => {
  const notAQr = { status: "not_a_qr", imageId: image } as const;
  expect(walletQrWasNotAQr(notAQr)).toBe(true);
  expect(can({ status: "upload_failed", imageId: image, previousNotAQr: walletQrWasNotAQr(notAQr) })).toBe(false);
  expect(can({ status: "wrong_file", imageId: image, previousNotAQr: true })).toBe(false);
  expect(walletQrWasNotAQr({ status: "upload_failed", imageId: image, previousNotAQr: true })).toBe(true);
});

test("after a successful save only an offered wallet with an image becomes a saved valid qr", () => {
  expect(walletQrAfterSave({ offered: false, state: { status: "empty" } })).toEqual({ status: "empty" });
  expect(walletQrAfterSave({ offered: true, state: { status: "empty" } })).toEqual({ status: "empty" });
  expect(walletQrAfterSave({ offered: true, state: { status: "upload_failed", imageId: null } })).toEqual({ status: "upload_failed", imageId: null });
  expect(walletQrAfterSave({ offered: true, state: { status: "unchecked", imageId: null } })).toEqual({ status: "unchecked", imageId: null });
  expect(walletQrAfterSave({ offered: true, state: { status: "check_unavailable", imageId: image } })).toEqual({ status: "valid", imageId: image, origin: "saved" });
  expect(can(walletQrAfterSave({ offered: true, state: { status: "empty" } }) )).toBe(false);
});

test("retry repeats the failed upload or the failed check", () => {
  const file = new File(["x"], "qr.png", { type: "image/png" });
  expect(walletQrRetry({ status: "upload_failed", imageId: null }, file)).toBe("upload");
  expect(walletQrRetry({ status: "upload_failed", imageId: image }, file)).toBe("upload");
  expect(walletQrRetry({ status: "upload_failed", imageId: image }, null)).toBeNull();
  expect(walletQrRetry({ status: "check_unavailable", imageId: image }, file)).toBe("check");
  expect(walletQrRetry({ status: "empty" }, file)).toBeNull();
});
