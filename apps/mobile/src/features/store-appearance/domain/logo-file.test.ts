import { decideLogoAsset, type LogoAsset } from "@mobile/features/store-appearance/domain/logo-file";

const png: LogoAsset = { mimeType: "image/png", fileName: "logo.png", uri: "file:///logo.png", fileSize: 200_000, width: 800, height: 400, source: "library" };

test("keeps a PNG, JPG or WEBP from the library as chosen with its own type", () => {
  expect(decideLogoAsset(png)).toEqual({ kind: "upload_as_is", mimeType: "image/png" });
  expect(decideLogoAsset({ ...png, mimeType: "image/jpg" })).toEqual({ kind: "upload_as_is", mimeType: "image/jpeg" });
  expect(decideLogoAsset({ ...png, mimeType: "image/webp" })).toEqual({ kind: "upload_as_is", mimeType: "image/webp" });
});

test("classifies a library asset without mimeType by its file extension", () => {
  expect(decideLogoAsset({ ...png, mimeType: null, fileName: "Logo.PNG" })).toEqual({ kind: "upload_as_is", mimeType: "image/png" });
  expect(decideLogoAsset({ ...png, mimeType: undefined, fileName: null, uri: "file:///cache/a.jpeg?x=1" })).toEqual({ kind: "upload_as_is", mimeType: "image/jpeg" });
  expect(decideLogoAsset({ ...png, mimeType: null, fileName: "logo.heic" })).toEqual({ kind: "convert_to_jpeg" });
});

test("converts HEIC and HEIF library photos and every camera photo to JPG", () => {
  expect(decideLogoAsset({ ...png, mimeType: "image/heic", fileName: "IMG.HEIC" })).toEqual({ kind: "convert_to_jpeg" });
  expect(decideLogoAsset({ ...png, mimeType: "image/heif" })).toEqual({ kind: "convert_to_jpeg" });
  expect(decideLogoAsset({ ...png, source: "camera", width: 8064, height: 6048, fileSize: 30_000_000 })).toEqual({ kind: "convert_to_jpeg" });
});

test("rejects a GIF before uploading with the format reason", () => {
  expect(decideLogoAsset({ ...png, mimeType: "image/gif", fileName: "a.gif" })).toEqual({ kind: "rejected", reason: "format" });
  expect(decideLogoAsset({ ...png, mimeType: null, fileName: "a.svg", uri: "file:///a.svg" })).toEqual({ kind: "rejected", reason: "format" });
});

test("rejects a 12 MB PNG with the size reason and a 9000 px PNG with the dimensions reason", () => {
  expect(decideLogoAsset({ ...png, fileSize: 12_000_000 })).toEqual({ kind: "rejected", reason: "size" });
  expect(decideLogoAsset({ ...png, width: 9000, height: 100 })).toEqual({ kind: "rejected", reason: "dimensions" });
  expect(decideLogoAsset({ ...png, width: 6000, height: 5000 })).toEqual({ kind: "rejected", reason: "dimensions" });
  expect(decideLogoAsset({ ...png, fileSize: 10_000_000, width: 8000, height: 3000 })).toEqual({ kind: "upload_as_is", mimeType: "image/png" });
});
