import { expect, test } from "vitest";
import { canSaveWalletQr, type WalletQrState } from "@core/src/features/companies/presentation/wallet-qr-field";

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
