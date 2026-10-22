import { err, ok } from "@shared/functional";
import { createStoreAppearanceOperations, sameDraft, type LogoFiles, type StoreAppearanceApi } from "@mobile/features/store-appearance/application/store-appearance";
import type { LogoAsset } from "@mobile/features/store-appearance/domain/logo-file";

const logoId = "00000000-0000-4000-8000-000000000001";
const png: LogoAsset = { mimeType: "image/png", fileName: "logo.png", uri: "file:///logo.png", fileSize: 200_000, width: 800, height: 400, source: "library" };

function setup(overrides: Partial<LogoFiles> = {}) {
  const logo = {
    convertToJpeg: jest.fn(async () => ok("file:///converted.jpg")),
    upload: jest.fn(async () => ok({ id: logoId, url: "https://img.test/logo" })),
    ...overrides,
  } satisfies LogoFiles;
  const api = { get: jest.fn(), save: jest.fn() } satisfies StoreAppearanceApi;
  return { logo, api, ops: createStoreAppearanceOperations({ api, logo }) };
}

test("uploads a PNG from the gallery with its own type and without re-encoding", async () => {
  const { ops, logo } = setup();
  expect(await ops.uploadStoreLogo(png)).toEqual({ success: true, data: { id: logoId, url: "https://img.test/logo" } });
  expect(logo.upload).toHaveBeenCalledWith("file:///logo.png", "image/png");
  expect(logo.convertToJpeg).not.toHaveBeenCalled();
});

test("converts a HEIC gallery photo and a camera photo and uploads the result as JPEG", async () => {
  const { ops, logo } = setup();
  await ops.uploadStoreLogo({ ...png, mimeType: "image/heic", fileName: "IMG.HEIC" });
  await ops.uploadStoreLogo({ ...png, source: "camera", uri: "file:///camera.jpg", width: 8064, height: 6048, fileSize: 30_000_000 });
  expect(logo.convertToJpeg).toHaveBeenCalledTimes(2);
  expect(logo.upload).toHaveBeenNthCalledWith(1, "file:///converted.jpg", "image/jpeg");
  expect(logo.upload).toHaveBeenNthCalledWith(2, "file:///converted.jpg", "image/jpeg");
});

test("rejects a GIF, a 12 MB PNG and a 9000 px PNG before any request", async () => {
  const { ops, logo } = setup();
  expect(await ops.uploadStoreLogo({ ...png, mimeType: "image/gif" })).toMatchObject({ success: false, error: { code: "UNSUPPORTED_FORMAT" } });
  expect(await ops.uploadStoreLogo({ ...png, fileSize: 12_000_000 })).toMatchObject({ success: false, error: { code: "FILE_TOO_HEAVY" } });
  expect(await ops.uploadStoreLogo({ ...png, width: 9000 })).toMatchObject({ success: false, error: { code: "DIMENSIONS_TOO_LARGE" } });
  expect(logo.upload).not.toHaveBeenCalled();
  expect(logo.convertToJpeg).not.toHaveBeenCalled();
});

test("reports a failed conversion and a failed upload as an upload failure, and the server's size answer as the dimensions text", async () => {
  const failedConversion = setup({ convertToJpeg: async () => err({ message: "boom" }) });
  expect(await failedConversion.ops.uploadStoreLogo({ ...png, source: "camera" })).toMatchObject({ success: false, error: { code: "UPLOAD_FAILED" } });
  expect(failedConversion.logo.upload).not.toHaveBeenCalled();
  const offline = setup({ upload: async () => err({ code: "NETWORK_ERROR", message: "offline" }) });
  expect(await offline.ops.uploadStoreLogo(png)).toMatchObject({ success: false, error: { code: "UPLOAD_FAILED" } });
  const tooLarge = setup({ upload: async () => err({ code: "IMAGE_TOO_LARGE", message: "413" }) });
  expect(await tooLarge.ops.uploadStoreLogo(png)).toMatchObject({ success: false, error: { code: "DIMENSIONS_TOO_LARGE" } });
});

test("compares drafts by theme and logo id, ignoring the logo url", () => {
  const draft = { theme: "suave", logo: { id: logoId, url: null } } as const;
  expect(sameDraft(draft, { theme: "suave", logo: { id: logoId, url: "https://img.test/a" } })).toBe(true);
  expect(sameDraft(draft, { theme: "noche", logo: draft.logo })).toBe(false);
  expect(sameDraft(draft, { theme: "suave", logo: null })).toBe(false);
});
