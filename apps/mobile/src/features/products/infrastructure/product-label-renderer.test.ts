import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { TextDecoder as NodeTextDecoder } from "node:util";
import jsQR from "jsqr";
import type { Skia } from "@shopify/react-native-skia";
import type { ProductLabel } from "@mobile/features/products/domain/product-label";

let mockSkia: typeof Skia;
let mockPng: Uint8Array | null = null;
let mockWriteFailure = false;

jest.mock("@shopify/react-native-skia", () => ({ Skia: mockSkia }));
jest.mock("expo-asset", () => ({ Asset: { fromModule: () => ({ downloadAsync: async () => ({ localUri: "file:///font.ttf" }) }) } }));
jest.mock("expo-crypto", () => ({ randomUUID: () => "00000000-0000-4000-8000-000000000001" }));
jest.mock("expo-file-system", () => ({
  Paths: { cache: { uri: "file:///cache/" } },
  File: class {
    uri = "file:///cache/yoyos-label-00000000-0000-4000-8000-000000000001.png";
    get exists() { return mockWriteFailure; }
    write(bytes: Uint8Array) { if (mockWriteFailure) throw new Error("write failed"); mockPng = bytes; }
    delete() { throw new Error("cleanup failed"); }
  },
}));

beforeAll(async () => {
  Object.defineProperty(globalThis, "TextDecoder", { configurable: true, value: NodeTextDecoder });
  const packageDir = dirname(require.resolve("@shopify/react-native-skia/package.json"));
  const canvasKitPath = require.resolve("canvaskit-wasm/bin/full/canvaskit.js", { paths: [packageDir] });
  const wasmPath = require.resolve("canvaskit-wasm/bin/full/canvaskit.wasm", { paths: [packageDir] });
  const canvasKit = await jest.requireActual(canvasKitPath)({ locateFile: () => wasmPath });
  mockSkia = jest.requireActual("@shopify/react-native-skia/lib/commonjs/skia/web").JsiSkApi(canvasKit);
  const font = readFileSync(resolve(__dirname, "../../../../assets/fonts/InterVariable.ttf"));
  jest.spyOn(mockSkia.Data, "fromURI").mockImplementation(async () => mockSkia.Data.fromBytes(font));
});

test("renders a Brother-size PNG whose QR decodes to the exact variant value", async () => {
  const { renderProductLabel } = jest.requireActual("@mobile/features/products/infrastructure/product-label-renderer");
  for (const qrCode of ["00000000-0000-4000-8000-000000000003", "00000000-0000-4000-8000-000000000007"]) {
    const label = { productName: "Camiseta básica ñ", sku: "CAM-1", qrCode } as ProductLabel;
    const result = await renderProductLabel(label, { widthPx: 696, heightPx: 271, dpiX: 300, dpiY: 300 });
    expect(result).toMatchObject({ success: true });
    expect(mockPng?.subarray(0, 8)).toEqual(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const image = mockSkia.Image.MakeImageFromEncoded(mockSkia.Data.fromBytes(mockPng!));
    expect(image?.width()).toBe(696);
    expect(image?.height()).toBe(271);
    const pixels = image?.readPixels();
    expect(pixels).toBeInstanceOf(Uint8Array);
    expect(Array.from(pixels!.subarray(0, 4))).toEqual([255, 255, 255, 255]);
    expect(Array.from(pixels!).filter((_, index) => index % 4 === 3).every((alpha) => alpha === 255)).toBe(true);
    expect(jsQR(Uint8ClampedArray.from(pixels!), 696, 271)?.data).toBe(label.qrCode);
  }
});

test("renders a long name without SKU and rejects an SKU that cannot fit", async () => {
  const { renderProductLabel } = jest.requireActual("@mobile/features/products/infrastructure/product-label-renderer");
  const profile = { widthPx: 696, heightPx: 271, dpiX: 300, dpiY: 300 };
  const label = { productName: "Camisa de algodón ".repeat(10), qrCode: "00000000-0000-4000-8000-000000000004" } as ProductLabel;
  expect(await renderProductLabel(label, profile)).toMatchObject({ success: true });
  expect(await renderProductLabel({ ...label, sku: "W".repeat(100) }, profile)).toMatchObject({ success: false, error: { code: "LABEL_CONTENT_OVERFLOW" } });
});

test("reports a render failure even when cleanup also fails", async () => {
  const { renderProductLabel } = jest.requireActual("@mobile/features/products/infrastructure/product-label-renderer");
  mockWriteFailure = true;
  try {
    await expect(renderProductLabel({ productName: "Camisa", qrCode: "00000000-0000-4000-8000-000000000004" } as ProductLabel,
      { widthPx: 696, heightPx: 271, dpiX: 300, dpiY: 300 })).resolves.toMatchObject({ success: false, error: { code: "RENDER_FAILED" } });
  } finally { mockWriteFailure = false; }
});
