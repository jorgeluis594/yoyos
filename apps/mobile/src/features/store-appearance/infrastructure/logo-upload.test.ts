import * as ImagePicker from "expo-image-picker";
import { ok } from "@shared/functional";
import { fitJpeg } from "@mobile/shared/infrastructure/jpeg-fitting";
import { uploadImage } from "@mobile/shared/infrastructure/image-api";
import { createLogoFiles } from "@mobile/features/store-appearance/infrastructure/logo-upload";

jest.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: jest.fn(), launchCameraAsync: jest.fn(), requestCameraPermissionsAsync: jest.fn(),
  UIImagePickerPreferredAssetRepresentationMode: { Current: "current", Compatible: "compatible", Automatic: "automatic" },
}));
jest.mock("@mobile/shared/infrastructure/jpeg-fitting", () => ({ fitJpeg: jest.fn() }));
jest.mock("@mobile/shared/infrastructure/image-api", () => ({ uploadImage: jest.fn() }));
const library = jest.mocked(ImagePicker.launchImageLibraryAsync);
const camera = jest.mocked(ImagePicker.launchCameraAsync);
const permission = jest.mocked(ImagePicker.requestCameraPermissionsAsync);
const request = jest.fn();
const asset = { uri: "file:///logo.png", width: 800, height: 400, mimeType: "image/png", fileName: "logo.png", fileSize: 1234 } as ImagePicker.ImagePickerAsset;
beforeEach(() => { library.mockReset(); camera.mockReset(); permission.mockReset(); jest.mocked(fitJpeg).mockReset(); jest.mocked(uploadImage).mockReset(); });

test("picks logos without editing and with the original asset representation", async () => {
  library.mockResolvedValue({ canceled: false, assets: [asset] });
  camera.mockResolvedValue({ canceled: false, assets: [{ ...asset, mimeType: "image/jpeg", fileName: "c.jpg" }] });
  permission.mockResolvedValue({ granted: true } as never);
  const files = createLogoFiles(request);
  expect(await files.pick("library")).toEqual({ success: true, data: { uri: asset.uri, width: 800, height: 400, mimeType: "image/png", fileName: "logo.png", fileSize: 1234, source: "library" } });
  expect(library).toHaveBeenCalledWith({ mediaTypes: ["images"], allowsEditing: false, allowsMultipleSelection: false, quality: 1, exif: false, preferredAssetRepresentationMode: "current" });
  expect(await files.pick("camera")).toMatchObject({ success: true, data: { source: "camera" } });
  expect(camera).toHaveBeenCalledWith({ mediaTypes: ["images"], allowsEditing: false, quality: 1, exif: false });
});

test("a cancelled pick is a success without asset and a denied camera permission is an error", async () => {
  library.mockResolvedValue({ canceled: true, assets: null });
  const files = createLogoFiles(request);
  expect(await files.pick("library")).toEqual({ success: true, data: null });
  permission.mockResolvedValue({ granted: false } as never);
  expect(await files.pick("camera")).toMatchObject({ success: false, error: { code: "CAMERA_PERMISSION_DENIED" } });
  expect(camera).not.toHaveBeenCalled();
});

test("reads the byte size from the file when the picker does not report it", async () => {
  library.mockResolvedValue({ canceled: false, assets: [{ ...asset, fileSize: undefined }] });
  const original = global.fetch;
  global.fetch = jest.fn(async () => ({ blob: async () => ({ size: 4321 }) })) as never;
  try {
    expect(await createLogoFiles(request).pick("library")).toMatchObject({ success: true, data: { fileSize: 4321 } });
  } finally { global.fetch = original; }
});

test("converts a HEIC gallery photo and a camera photo to a JPG of at most 1024 px on its longest side", async () => {
  jest.mocked(fitJpeg).mockResolvedValue(ok("file:///fitted.jpg"));
  const files = createLogoFiles(request);
  const converted = await files.convertToJpeg({ uri: "file:///a.heic", width: 8064, height: 6048, fileSize: 9_000_000, source: "camera" });
  expect(converted).toEqual({ success: true, data: "file:///fitted.jpg" });
  expect(fitJpeg).toHaveBeenCalledWith("file:///a.heic", 8064, 6048, { maxSide: 1024, maxBytes: 10_000_000 });
});

test("uploads with the original MIME type through the image API", async () => {
  jest.mocked(uploadImage).mockResolvedValue(ok({ id: "x", url: "https://img.test/x" }));
  await createLogoFiles(request).upload("file:///logo.png", "image/png");
  expect(uploadImage).toHaveBeenCalledWith(request, "file:///logo.png", "image/png");
});
