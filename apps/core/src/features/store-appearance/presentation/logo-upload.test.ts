import { expect, test, vi } from "vitest";
import { imageUploadLimits } from "@shared/contracts/images";
import { uploadLogo } from "@core/src/features/store-appearance/presentation/logo-upload";

const png = (size = 10) => new File([new Uint8Array(size)], "logo.png", { type: "image/png" });
const answer = (status: number, body: unknown = {}) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

test("a 413 from the image API on web shows the logo dimensions text", async () => {
  expect(await uploadLogo(png(), answer(413, { code: "IMAGE_TOO_LARGE" }))).toBe("dimensions");
});

test("web rejects a logo over the shared byte limit before uploading", async () => {
  const send = answer(201);
  expect(await uploadLogo(png(imageUploadLimits.maxBytes + 1), send)).toBe("size");
  expect(send).not.toHaveBeenCalled();
});

test("web rejects a logo that is not PNG, JPEG or WEBP before uploading", async () => {
  const send = answer(201);
  expect(await uploadLogo(new File(["x"], "logo.gif", { type: "image/gif" }), send)).toBe("type");
  expect(send).not.toHaveBeenCalled();
});

test("returns the stored image, and a failure for any other answer or a lost request", async () => {
  const stored = { id: crypto.randomUUID(), url: "https://cdn.test/logo.png" };
  expect(await uploadLogo(png(), answer(201, stored))).toEqual(stored);
  expect(await uploadLogo(png(), answer(500))).toBe("failed");
  expect(await uploadLogo(png(), vi.fn(async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch)).toBe("failed");
});
