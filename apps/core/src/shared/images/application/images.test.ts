import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { findCompletedPrivateImageImport, getImage, getImages, importPrivateImage, uploadImage, type ImageRepository, type ImageStorage } from "@core/src/shared/images/application/images";

const id = crypto.randomUUID();
const companyId = crypto.randomUUID();
const input = { bytes: new Uint8Array([255, 216, 255]), filename: "a.jpg", contentType: "image/jpeg" };

function setup() {
  const storage: ImageStorage = {
    upload: vi.fn(async () => ({ success: true as const, data: { key: "remote" } })),
    uploadPrivate: vi.fn(async () => ({ success: true as const, data: undefined })),
    readPrivate: vi.fn(async () => ({ success: true as const, data: { bytes: new Uint8Array(), contentType: "image/png" } })),
    getUrl: vi.fn(async () => ({ success: true as const, data: "https://example.test/image" })),
    delete: vi.fn(async () => ({ success: true as const, data: undefined })),
  };
  const repository: ImageRepository = {
    create: vi.fn(async () => ({ success: true as const, data: { id } })),
    find: vi.fn(async () => ({ success: true as const, data: { id, storageKey: "remote" } })),
    findMany: vi.fn(async () => ({ success: true as const, data: [] })),
    findCompletedImport: vi.fn(async () => ({ success: true as const, data: null })),
    reserveImport: vi.fn(async () => ({ success: true as const, data: { id, storageKey: "private/key" } })),
    completeImport: vi.fn(async () => ({ success: true as const, data: undefined })),
  };
  return { storage, repository };
}

describe("images use cases", () => {
  it("looks up a completed private import within its company and propagates lookup failures", async () => {
    const { repository } = setup();
    const sourceKey = "whatsapp-message:message-1";
    expect(await findCompletedPrivateImageImport(companyId, sourceKey, repository)).toEqual({ success: true, data: null });
    expect(repository.findCompletedImport).toHaveBeenCalledWith(companyId, sourceKey);
    vi.mocked(repository.findCompletedImport).mockResolvedValueOnce({ success: true, data: { id } });
    expect(await findCompletedPrivateImageImport(companyId, sourceKey, repository)).toEqual({ success: true, data: { id } });
    const failure = { code: "PERSISTENCE_UNAVAILABLE" as const, message: "database down" };
    vi.mocked(repository.findCompletedImport).mockResolvedValueOnce({ success: false, error: failure });
    expect(await findCompletedPrivateImageImport(companyId, sourceKey, repository)).toEqual({ success: false, error: failure });
  });

  it("returns the stored ID and URL and resolves a tenant image", async () => {
    const { storage, repository } = setup();
    expect(await uploadImage(input, storage, repository)).toEqual({ success: true, data: { id, url: "https://example.test/image" } });
    expect(await getImage(id, storage, repository)).toEqual({ success: true, data: { id, url: "https://example.test/image" } });
    expect(repository.find).toHaveBeenCalledWith(id);
  });

  it("validates and imports source bytes privately with a stable source key", async () => {
    const { storage, repository } = setup();
    const bytes = new Uint8Array(await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).png().toBuffer());
    expect(await importPrivateImage(companyId, "whatsapp-message:message-1", { bytes, filename: "original.png", declaredContentType: "image/png" }, storage, repository)).toEqual({ success: true, data: { id } });
    expect(storage.uploadPrivate).toHaveBeenCalledWith("private/key", { bytes, contentType: "image/png" });
    expect(repository.completeImport).toHaveBeenCalledWith(companyId, id);
  });

  it("rejects invalid imports before reserving an image", async () => {
    const { storage, repository } = setup();
    expect(await importPrivateImage(companyId, "whatsapp-message:message-1", { bytes: new Uint8Array([1]), filename: "bad", declaredContentType: "image/png" }, storage, repository)).toMatchObject({ success: false, error: { code: "INVALID_IMAGE" } });
    expect(repository.reserveImport).not.toHaveBeenCalled();
  });

  it("deletes the remote file when local persistence fails", async () => {
    const { storage, repository } = setup();
    repository.create = vi.fn(async () => ({ success: false as const, error: { code: "PERSISTENCE_UNAVAILABLE", message: "database down" } }));
    expect(await uploadImage(input, storage, repository)).toEqual({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE", message: "database down" } });
    expect(storage.delete).toHaveBeenCalledWith("remote");
  });

  it("reports failed compensation without hiding the original failure", async () => {
    const { storage, repository } = setup();
    repository.create = vi.fn(async () => { throw new Error("database down"); });
    storage.delete = vi.fn(async () => ({ success: false as const, error: { message: "delete failed" } }));
    await expect(uploadImage(input, storage, repository)).rejects.toThrow("database down");
    expect(storage.delete).toHaveBeenCalledWith("remote");
  });

  it("preserves a persistence failure when cleanup throws", async () => {
    const { storage, repository } = setup();
    const failure = { code: "PERSISTENCE_UNAVAILABLE", message: "database down" };
    repository.create = vi.fn(async () => ({ success: false as const, error: failure }));
    storage.delete = vi.fn(async () => { throw new Error("delete failed"); });
    expect(await uploadImage(input, storage, repository)).toEqual({ success: false, error: failure });
    expect(storage.delete).toHaveBeenCalledWith("remote");
  });

  it("passes provider failures through without writing locally", async () => {
    const { storage, repository } = setup();
    storage.upload = vi.fn(async () => ({ success: false as const, error: { message: "provider down" } }));
    expect(await uploadImage(input, storage, repository)).toEqual({ success: false, error: { message: "provider down" } });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("compensates when the public URL cannot be obtained", async () => {
    const { storage, repository } = setup();
    storage.getUrl = vi.fn(async () => ({ success: false as const, error: { code: "IMAGE_STORAGE_CONFIG_ERROR", message: "bad URL" } }));
    expect(await uploadImage(input, storage, repository)).toEqual({ success: false, error: { code: "IMAGE_STORAGE_CONFIG_ERROR", message: "bad URL" } });
    expect(storage.delete).toHaveBeenCalledWith("remote");
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("preserves an unexpected URL failure after cleanup", async () => {
    const { storage, repository } = setup();
    const failure = new Error("URL lookup failed");
    storage.getUrl = vi.fn(async () => { throw failure; });
    await expect(uploadImage(input, storage, repository)).rejects.toBe(failure);
    expect(storage.delete).toHaveBeenCalledWith("remote");
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("propagates repository read failures without requesting a URL", async () => {
    const { storage, repository } = setup();
    repository.find = vi.fn(async () => ({ success: false as const, error: { code: "PERSISTENCE_UNAVAILABLE" as const, message: "database down" } }));
    expect(await getImage(id, storage, repository)).toEqual({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE", message: "database down" } });
    expect(storage.getUrl).not.toHaveBeenCalled();
  });

  it("resolves several images with one lookup and keeps each failure kind", async () => {
    const { storage, repository } = setup();
    const [shown, hidden, broken, missing] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    repository.findMany = vi.fn(async () => ({ success: true as const, data: [
      { id: shown, storageKey: "shown" }, { id: hidden, storageKey: "hidden", visibility: "private" as const }, { id: broken, storageKey: "broken" },
    ] }));
    storage.getUrl = vi.fn(async (key: string) => key === "broken"
      ? { success: false as const, error: { code: "IMAGE_STORAGE_CONFIG_ERROR", message: "Image storage is not configured" } }
      : { success: true as const, data: `https://example.test/${key}` });
    expect(await getImages([shown, hidden, shown, broken, missing], storage, repository)).toEqual({ success: true, data: {
      images: [{ id: shown, url: "https://example.test/shown" }],
      failures: [
        { id: hidden, code: "PRIVATE_IMAGE", message: "Private image requires authorized streaming" },
        { id: broken, code: "IMAGE_STORAGE_CONFIG_ERROR", message: "Image storage is not configured" },
      ],
    } });
    expect(repository.findMany).toHaveBeenCalledOnce();
    expect(repository.findMany).toHaveBeenCalledWith([shown, hidden, broken, missing]);
    expect(repository.find).not.toHaveBeenCalled();
  });

  it("skips the lookup for no images and propagates batch lookup failures", async () => {
    const { storage, repository } = setup();
    expect(await getImages([], storage, repository)).toEqual({ success: true, data: { images: [], failures: [] } });
    expect(repository.findMany).not.toHaveBeenCalled();
    const failure = { code: "PERSISTENCE_UNAVAILABLE" as const, message: "database down" };
    repository.findMany = vi.fn(async () => ({ success: false as const, error: failure }));
    expect(await getImages([id], storage, repository)).toEqual({ success: false, error: failure });
    expect(storage.getUrl).not.toHaveBeenCalled();
  });

  it("stops asking storage for URLs after a configuration failure", async () => {
    const { storage, repository } = setup();
    const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    repository.findMany = vi.fn(async () => ({ success: true as const, data: ids.map((imageId) => ({ id: imageId, storageKey: imageId })) }));
    storage.getUrl = vi.fn(async () => ({ success: false as const, error: { code: "IMAGE_STORAGE_CONFIG_ERROR", message: "Image storage is not configured" } }));
    expect(await getImages(ids, storage, repository)).toEqual({ success: true, data: {
      images: [],
      failures: ids.map((imageId) => ({ id: imageId, code: "IMAGE_STORAGE_CONFIG_ERROR", message: "Image storage is not configured" })),
    } });
    expect(storage.getUrl).toHaveBeenCalledOnce();
  });
});
