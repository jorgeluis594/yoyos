import { afterEach, expect, test, vi } from "vitest";
import { uploadImageFile } from "@core/src/shared/images/presentation/client";

const file = new File([new Uint8Array([1, 2, 3])], "photo.png", { type: "image/png" });
const id = "00000000-0000-4000-8000-0000000000aa";
const url = "https://images.example.test/photo.png";

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => vi.restoreAllMocks());

test("returns the uploaded image identifier and URL", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(201, { id, url }));
  expect(await uploadImageFile(file)).toEqual({ success: true, data: { id, url } });
  expect(fetchMock).toHaveBeenCalledWith("/api/images", expect.objectContaining({ method: "POST" }));
});

test("surfaces the server error code for a rejected upload", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(502, { code: "IMAGE_STORAGE_UNAVAILABLE", error: "Image storage unavailable" }));
  expect(await uploadImageFile(file)).toEqual({ success: false, error: { code: "IMAGE_STORAGE_UNAVAILABLE", message: "Image upload was rejected" } });
});

test("rejects an invalid response shape and reports unavailable transport", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(201, { id: "not-a-uuid", url: "ftp://invalid" }));
  expect(await uploadImageFile(file)).toEqual({ success: false, error: { code: "INVALID_IMAGE_RESPONSE", message: "Invalid image response" } });
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
  expect(await uploadImageFile(file)).toEqual({ success: false, error: { code: "IMAGE_UPLOAD_UNAVAILABLE", message: "Unable to reach the image service" } });
});
