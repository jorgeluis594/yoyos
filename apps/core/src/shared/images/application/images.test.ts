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
    create: vi.fn(async () => ({ id })),
    find: vi.fn(async () => ({ id, storageKey: "remote" })),
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
    repository.create = vi.fn(async () => { throw new Error("database down"); });
    await expect(uploadImage(companyId, input, storage, repository)).rejects.toThrow("database down");
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

  it("passes provider failures through without writing locally", async () => {
    const { storage, repository } = setup();
    storage.upload = vi.fn(async () => ({ success: false as const, error: { message: "provider down" } }));
    expect(await uploadImage(companyId, input, storage, repository)).toEqual({ success: false, error: { message: "provider down" } });
    expect(repository.create).not.toHaveBeenCalled();
  });
});
