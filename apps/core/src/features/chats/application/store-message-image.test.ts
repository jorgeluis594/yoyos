import { describe, expect, it, vi } from "vitest";
import { storeMessageImage, type StoreImageDependencies } from "@core/src/features/chats/application/store-message-image";

function setup(): StoreImageDependencies {
  return {
    findCompletedPrivateImageImport: vi.fn(async () => ({ success: true as const, data: null })),
    download: vi.fn(async () => ({ success: true as const, data: { bytes: new Uint8Array([1]), filename: "media-1", declaredContentType: "image/png" } })),
    importPrivateImage: vi.fn(async () => ({ success: true as const, data: { id: "image-1" } })),
  };
}

describe("storeMessageImage", () => {
  it("downloads and imports before returning a ready image", async () => {
    const deps = setup();
    expect(await storeMessageImage("wamid.1", "media-1", deps)).toEqual({ success: true, data: { status: "ready", mediaId: "media-1", imageId: "image-1" } });
    expect(deps.importPrivateImage).toHaveBeenCalledWith("whatsapp-message:wamid.1", expect.objectContaining({ filename: "media-1" }));
  });

  it("reuses an existing import without downloading", async () => {
    const deps = setup();
    vi.mocked(deps.findCompletedPrivateImageImport).mockResolvedValueOnce({ success: true, data: { id: "image-1" } });
    expect(await storeMessageImage("wamid.1", "media-1", deps)).toMatchObject({ success: true, data: { status: "ready", imageId: "image-1" } });
    expect(deps.download).not.toHaveBeenCalled();
  });

  it("records invalid images and unavailable storage as final failures", async () => {
    const deps = setup();
    vi.mocked(deps.importPrivateImage).mockResolvedValueOnce({ success: false, error: { code: "INVALID_IMAGE", message: "invalid pixels" } });
    expect(await storeMessageImage("wamid.1", "media-1", deps)).toEqual({ success: true, data: { status: "failed", mediaId: "media-1", failure: { code: "INVALID_IMAGE", message: "invalid pixels" } } });
    vi.mocked(deps.importPrivateImage).mockResolvedValueOnce({ success: false, error: { code: "IMAGE_STORAGE_UNAVAILABLE", message: "storage down" } });
    expect(await storeMessageImage("wamid.1", "media-1", deps)).toEqual({ success: true, data: { status: "failed", mediaId: "media-1", failure: { code: "IMAGE_STORAGE_UNAVAILABLE", message: "storage down" } } });
    vi.mocked(deps.download).mockResolvedValueOnce({ success: false, error: { code: "MEDIA_UNAVAILABLE", message: "download failed" } });
    expect(await storeMessageImage("wamid.1", "media-1", deps)).toEqual({ success: true, data: { status: "failed", mediaId: "media-1", failure: { code: "MEDIA_UNAVAILABLE", message: "download failed" } } });
  });
});
