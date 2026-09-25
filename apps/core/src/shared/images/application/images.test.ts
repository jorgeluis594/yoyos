import { describe, expect, it, vi } from "vitest";
import { getImage, uploadImage, type ImageRepository, type ImageStorage } from "@core/src/shared/images/application/images";

const companyId = crypto.randomUUID();
const id = crypto.randomUUID();
const input = { bytes: new Uint8Array([255, 216, 255]), filename: "a.jpg", contentType: "image/jpeg" };

function setup() {
  const storage: ImageStorage = {
    upload: vi.fn(async () => ({ success: true as const, data: { key: "remote" } })),
    getUrl: vi.fn(async () => ({ success: true as const, data: "https://example.test/image" })),
    delete: vi.fn(async () => ({ success: true as const, data: undefined })),
  };
  const repository: ImageRepository = {
    create: vi.fn(async () => ({ success: true as const, data: { id } })),
    find: vi.fn(async () => ({ success: true as const, data: { id, storageKey: "remote" } })),
  };
  return { storage, repository };
}

describe("images use cases", () => {
  it("returns the stored ID and URL and resolves a tenant image", async () => {
    const { storage, repository } = setup();
    expect(await uploadImage(companyId, input, storage, repository)).toEqual({ success: true, data: { id, url: "https://example.test/image" } });
    expect(await getImage(companyId, id, storage, repository)).toEqual({ success: true, data: { id, url: "https://example.test/image" } });
    expect(repository.find).toHaveBeenCalledWith(companyId, id);
  });

  it("deletes the remote file when local persistence fails", async () => {
    const { storage, repository } = setup();
    repository.create = vi.fn(async () => ({ success: false as const, error: { code: "PERSISTENCE_UNAVAILABLE", message: "database down" } }));
    expect(await uploadImage(companyId, input, storage, repository)).toEqual({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE", message: "database down" } });
    expect(storage.delete).toHaveBeenCalledWith("remote");
  });

  it("reports failed compensation without hiding the original failure", async () => {
    const { storage, repository } = setup();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    repository.create = vi.fn(async () => { throw new Error("database down"); });
    storage.delete = vi.fn(async () => ({ success: false as const, error: { message: "delete failed" } }));
    try {
      await expect(uploadImage(companyId, input, storage, repository)).rejects.toThrow("database down");
      expect(logged).toHaveBeenCalledWith("Image cleanup failed", expect.objectContaining({ key: "remote" }));
    } finally {
      logged.mockRestore();
    }
  });

  it("preserves a persistence failure when cleanup throws", async () => {
    const { storage, repository } = setup();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = { code: "PERSISTENCE_UNAVAILABLE", message: "database down" };
    repository.create = vi.fn(async () => ({ success: false as const, error: failure }));
    storage.delete = vi.fn(async () => { throw new Error("delete failed"); });
    try {
      expect(await uploadImage(companyId, input, storage, repository)).toEqual({ success: false, error: failure });
      expect(storage.delete).toHaveBeenCalledWith("remote");
      expect(logged).toHaveBeenCalledWith("Image cleanup failed", expect.objectContaining({ cause: failure, error: expect.any(Error) }));
    } finally {
      logged.mockRestore();
    }
  });

  it("passes provider failures through without writing locally", async () => {
    const { storage, repository } = setup();
    storage.upload = vi.fn(async () => ({ success: false as const, error: { message: "provider down" } }));
    expect(await uploadImage(companyId, input, storage, repository)).toEqual({ success: false, error: { message: "provider down" } });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("compensates when the public URL cannot be obtained", async () => {
    const { storage, repository } = setup();
    storage.getUrl = vi.fn(async () => ({ success: false as const, error: { code: "IMAGE_STORAGE_CONFIG_ERROR", message: "bad URL" } }));
    expect(await uploadImage(companyId, input, storage, repository)).toEqual({ success: false, error: { code: "IMAGE_STORAGE_CONFIG_ERROR", message: "bad URL" } });
    expect(storage.delete).toHaveBeenCalledWith("remote");
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("preserves an unexpected URL failure after cleanup", async () => {
    const { storage, repository } = setup();
    const failure = new Error("URL lookup failed");
    storage.getUrl = vi.fn(async () => { throw failure; });
    await expect(uploadImage(companyId, input, storage, repository)).rejects.toBe(failure);
    expect(storage.delete).toHaveBeenCalledWith("remote");
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("propagates repository read failures without requesting a URL", async () => {
    const { storage, repository } = setup();
    repository.find = vi.fn(async () => ({ success: false as const, error: { code: "PERSISTENCE_UNAVAILABLE" as const, message: "database down" } }));
    expect(await getImage(companyId, id, storage, repository)).toEqual({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE", message: "database down" } });
    expect(storage.getUrl).not.toHaveBeenCalled();
  });
});
