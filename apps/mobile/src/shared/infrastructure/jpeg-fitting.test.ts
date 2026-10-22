import * as ImageManipulator from "expo-image-manipulator";
import { fitJpeg } from "@mobile/shared/infrastructure/jpeg-fitting";

jest.mock("expo-image-manipulator", () => ({ manipulateAsync: jest.fn(), SaveFormat: { JPEG: "jpeg" } }));
const manipulate = jest.mocked(ImageManipulator.manipulateAsync);
const originalFetch = global.fetch;

function answerSizes(sizes: readonly number[]) {
  let call = 0;
  manipulate.mockImplementation(async (_uri, actions) => {
    const resize = (actions ?? []).find((action): action is { resize: { width: number; height: number } } => "resize" in action)?.resize;
    return { uri: `file:///fitted-${call}.jpg`, width: resize?.width ?? 4000, height: resize?.height ?? 3000, base64: undefined } as never;
  });
  global.fetch = jest.fn(async () => ({ blob: async () => ({ size: sizes[Math.min(call++, sizes.length - 1)] }) })) as never;
}
beforeEach(() => manipulate.mockReset());
afterEach(() => { global.fetch = originalFetch; });

test("scales a photo down to the longest side and keeps the first attempt that fits the byte bound", async () => {
  answerSizes([900_000]);
  const result = await fitJpeg("file:///a.jpg", 4000, 3000, { maxSide: 1024, maxBytes: 1_000_000 });
  expect(result).toEqual({ success: true, data: "file:///fitted-0.jpg" });
  expect(manipulate).toHaveBeenCalledTimes(1);
  expect(manipulate).toHaveBeenCalledWith("file:///a.jpg", [{ resize: { width: 1024, height: 768 } }], { compress: 0.82, format: "jpeg" });
});

test("lowers quality and size through four attempts and then reports the photo as too large", async () => {
  answerSizes([5_000_000]);
  const result = await fitJpeg("file:///a.jpg", 4000, 3000, { maxSide: 8000, maxPixels: 24_000_000, maxBytes: 1_000_000 });
  expect(result).toEqual({ success: false, error: { code: "TOO_LARGE", message: expect.any(String) } });
  expect(manipulate).toHaveBeenCalledTimes(4);
  expect(manipulate.mock.calls.map(call => call[2]?.compress)).toEqual([0.82, 0.72, 0.62, 0.52]);
});

test("does not resize a photo already inside the bounds", async () => {
  answerSizes([100]);
  await fitJpeg("file:///a.jpg", 800, 600, { maxSide: 1024, maxBytes: 1_000_000 });
  expect(manipulate).toHaveBeenCalledWith("file:///a.jpg", [], { compress: 0.82, format: "jpeg" });
});
