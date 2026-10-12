import { err, ok } from "@shared/functional";
import { uploadImage } from "@mobile/shared/infrastructure/image-api";

const imageId = "00000000-0000-4000-8000-000000000005";

beforeEach(() => {
  global.fetch = jest.fn(async () => ({ blob: async () => new Blob(["bytes"]) })) as unknown as typeof fetch;
});

test("uploads the file as multipart with the given mimeType and returns the image id", async () => {
  const request = jest.fn(async (_path: string, _init?: RequestInit) => ok<unknown>({ id: imageId, url: "https://cdn.example/a.png" }));
  const result = await uploadImage(request, "file:///a.png", "image/png");
  expect(result).toEqual({ success: true, data: { id: imageId, url: "https://cdn.example/a.png" } });
  const [path, init] = request.mock.calls[0] ?? [];
  expect(path).toBe("/api/images");
  expect(init?.method).toBe("POST");
  const file = (init?.body as FormData).get("file") as Blob;
  expect(file.type).toBe("image/png");
});

test("maps 400, 413 and 415 to INVALID_IMAGE, IMAGE_TOO_LARGE and UNSUPPORTED_MEDIA_TYPE", async () => {
  for (const [code, status] of [["INVALID_IMAGE", 400], ["IMAGE_TOO_LARGE", 413], ["UNSUPPORTED_MEDIA_TYPE", 415]] as const) {
    const failure = { code, message: "m", http: { status, body: { code, error: "m" } } };
    expect(await uploadImage(async () => err(failure), "file:///a.jpg", "image/jpeg")).toMatchObject({ success: false, error: { code } });
  }
});
