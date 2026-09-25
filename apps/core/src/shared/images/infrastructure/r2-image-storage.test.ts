import { afterEach, expect, it, vi } from "vitest";
import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { createR2ImageStorage } from "@core/src/shared/images/infrastructure/r2-image-storage";

const send = vi.hoisted(() => vi.fn());
vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-s3")>();
  return { ...actual, S3Client: class { send = send; } };
});

const config = {
  endpoint: "https://account.r2.cloudflarestorage.com",
  bucket: "images",
  accessKeyId: "access",
  secretAccessKey: "secret",
  publicBaseUrl: "https://images.example.test/",
};

afterEach(() => { vi.restoreAllMocks(); send.mockReset(); });

it("uploads bytes with content type, returns an opaque key and builds the public URL", async () => {
  send.mockResolvedValueOnce({});
  const storage = createR2ImageStorage(config);
  const bytes = new Uint8Array([1, 2]);
  const uploaded = await storage.upload({ bytes, filename: "original.png", contentType: "image/png" });
  expect(uploaded.success).toBe(true);
  if (!uploaded.success) return;
  expect(uploaded.data.key).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/);
  expect(send).toHaveBeenCalledWith(expect.any(PutObjectCommand));
  expect(send.mock.calls[0][0].input).toEqual({ Bucket: "images", Key: uploaded.data.key, Body: bytes, ContentType: "image/png" });
  expect(await storage.getUrl(uploaded.data.key)).toEqual({ success: true, data: `https://images.example.test/${uploaded.data.key}` });
  send.mockResolvedValueOnce({});
  expect(await storage.delete(uploaded.data.key)).toEqual({ success: true, data: undefined });
  expect(send.mock.calls[1][0]).toBeInstanceOf(DeleteObjectCommand);
  expect(send.mock.calls[1][0].input).toEqual({ Bucket: "images", Key: uploaded.data.key });
});

it("translates R2 upload and delete failures and rejects missing configuration", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  const storage = createR2ImageStorage(config);
  send.mockRejectedValueOnce(new Error("R2 unavailable"));
  expect(await storage.upload({ bytes: new Uint8Array([1]), filename: "a.png", contentType: "image/png" })).toEqual({ success: false, error: { code: "IMAGE_STORAGE_UNAVAILABLE", message: "Image upload failed" } });
  send.mockRejectedValueOnce(new Error("R2 unavailable"));
  expect(await storage.delete("key")).toEqual({ success: false, error: { code: "IMAGE_STORAGE_UNAVAILABLE", message: "Image deletion failed" } });
  expect(logged).toHaveBeenCalledTimes(2);
  expect(await createR2ImageStorage({ ...config, bucket: "" }).getUrl("key")).toEqual({ success: false, error: { code: "IMAGE_STORAGE_CONFIG_ERROR", message: "Image storage is not configured" } });
});
