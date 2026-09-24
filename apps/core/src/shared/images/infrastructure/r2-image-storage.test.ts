import { afterEach, expect, it, vi } from "vitest";
import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { createR2ImageStorage } from "@core/src/shared/images/infrastructure/r2-image-storage";

const send = vi.hoisted(() => vi.fn());
const construct = vi.hoisted(() => vi.fn());
vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-s3")>();
  return { ...actual, S3Client: class { constructor() { construct(); } send = send; } };
});

const config = {
  endpoint: "https://account.r2.cloudflarestorage.com",
  bucket: "images",
  accessKeyId: "access",
  secretAccessKey: "secret",
  publicBaseUrl: "https://images.example.test/",
};

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); send.mockReset(); construct.mockClear(); });

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

it("translates R2 upload and delete failures", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  const storage = createR2ImageStorage(config);
  send.mockRejectedValueOnce(new Error("R2 unavailable"));
  expect(await storage.upload({ bytes: new Uint8Array([1]), filename: "a.png", contentType: "image/png" })).toEqual({ success: false, error: { code: "IMAGE_STORAGE_UNAVAILABLE", message: "Image upload failed" } });
  send.mockRejectedValueOnce(new Error("R2 unavailable"));
  expect(await storage.delete("key")).toEqual({ success: false, error: { code: "IMAGE_STORAGE_UNAVAILABLE", message: "Image deletion failed" } });
  expect(logged).toHaveBeenCalledTimes(2);
});

it.each([
  ["https://images.example.test", "https://images.example.test/a%2Fb%20c"],
  ["https://images.example.test/", "https://images.example.test/a%2Fb%20c"],
  ["https://images.example.test/prefix", "https://images.example.test/prefix/a%2Fb%20c"],
  ["https://images.example.test/prefix/", "https://images.example.test/prefix/a%2Fb%20c"],
])("builds a public URL from %s", async (publicBaseUrl, expected) => {
  const storage = createR2ImageStorage({ ...config, publicBaseUrl });
  expect(await storage.getUrl("a/b c")).toEqual({ success: true, data: expected });
});

it.each([
  "ftp://images.example.test", "https://user:pass@images.example.test",
  "https://images.example.test?version=1", "https://images.example.test#fragment",
  "https://images.example.test?", "https://images.example.test#", "not a URL",
])("rejects an invalid public base: %s", async (publicBaseUrl) => {
  const storage = createR2ImageStorage({ ...config, publicBaseUrl });
  expect(await storage.getUrl("key")).toEqual({ success: false, error: { code: "IMAGE_STORAGE_CONFIG_ERROR", message: "Image storage is not configured" } });
});

it.each([
  "ftp://account.example.test", "https://user:pass@account.example.test",
  "https://account.example.test/path", "https://account.example.test?version=1",
  "https://account.example.test#fragment", "not a URL",
])("rejects an invalid write endpoint: %s", async (endpoint) => {
  const storage = createR2ImageStorage({ ...config, endpoint });
  expect(construct).not.toHaveBeenCalled();
  expect(await storage.getUrl("key")).toEqual({ success: true, data: "https://images.example.test/key" });
  expect(await storage.upload({ bytes: new Uint8Array([1]), filename: "a.png", contentType: "image/png" })).toEqual({ success: false, error: { code: "IMAGE_STORAGE_CONFIG_ERROR", message: "Image storage is not configured" } });
  expect(await storage.delete("key")).toEqual({ success: false, error: { code: "IMAGE_STORAGE_CONFIG_ERROR", message: "Image storage is not configured" } });
  expect(send).not.toHaveBeenCalled();
});

it.each(["bucket", "accessKeyId", "secretAccessKey"] as const)("builds public URLs without %s", async (field) => {
  const storage = createR2ImageStorage({ ...config, [field]: "" });
  expect(construct).not.toHaveBeenCalled();
  expect(await storage.getUrl("key")).toEqual({ success: true, data: "https://images.example.test/key" });
  expect(await storage.upload({ bytes: new Uint8Array([1]), filename: "a.png", contentType: "image/png" })).toEqual({ success: false, error: { code: "IMAGE_STORAGE_CONFIG_ERROR", message: "Image storage is not configured" } });
  expect(await storage.delete("key")).toEqual({ success: false, error: { code: "IMAGE_STORAGE_CONFIG_ERROR", message: "Image storage is not configured" } });
});

it("requires HTTPS for both URLs in production and permits HTTP in development", async () => {
  vi.stubEnv("NODE_ENV", "development");
  const http = createR2ImageStorage({ ...config, endpoint: "http://localhost:9000", publicBaseUrl: "http://localhost:9001/images" });
  expect(await http.getUrl("key")).toEqual({ success: true, data: "http://localhost:9001/images/key" });
  expect(construct).toHaveBeenCalledTimes(1);

  construct.mockClear();
  vi.stubEnv("NODE_ENV", "production");
  const insecure = createR2ImageStorage({ ...config, endpoint: "http://localhost:9000", publicBaseUrl: "http://localhost:9001/images" });
  expect(construct).not.toHaveBeenCalled();
  expect(await insecure.getUrl("key")).toEqual({ success: false, error: { code: "IMAGE_STORAGE_CONFIG_ERROR", message: "Image storage is not configured" } });
  const secureBase = createR2ImageStorage({ ...config, endpoint: "http://localhost:9000" });
  expect(construct).not.toHaveBeenCalled();
  expect(await secureBase.getUrl("key")).toEqual({ success: true, data: "https://images.example.test/key" });
});
