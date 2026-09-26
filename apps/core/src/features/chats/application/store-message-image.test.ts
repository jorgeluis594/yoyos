import { describe, expect, it, vi } from "vitest";
import type { Result } from "@shared/result";
import { storeMessageImage, type StoreImageDependencies } from "@core/src/features/chats/application/store-message-image";

const job = { messageId: "2e98e108-1821-4fd1-a507-21e3e00b76f1", mediaId: "media-1", claimToken: "claim-1", attempts: 1, leaseUntil: new Date(10_000) };
function setup(): StoreImageDependencies {
  const complete = vi.fn(async (): Promise<Result<"updated" | "claim_lost">> => ({ success: true, data: "updated" }));
  return {
    download: vi.fn(async () => ({ success: false as const, error: { code: "MEDIA_UNAVAILABLE", message: "temporary" } })),
    storage: { upload: vi.fn(), uploadPrivate: vi.fn(), readPrivate: vi.fn(), getUrl: vi.fn(), delete: vi.fn() },
    findCompletedImport: vi.fn(async () => ({ success: true as const, data: null })),
    importImage: vi.fn(async () => ({ success: true as const, data: { id: "image-1" } })),
    work: { claimNext: vi.fn(), complete },
    now: () => new Date(1_000),
    retryDelaysMs: [60_000],
  };
}

describe("storeMessageImage", () => {
  it("persists a bounded retry based on the controlled clock", async () => {
    const deps = setup();
    expect(await storeMessageImage(job, deps)).toEqual({ success: true, data: "retry_scheduled" });
    expect(deps.work.complete).toHaveBeenCalledWith(expect.objectContaining({ completion: { status: "pending", nextAttemptAt: new Date(61_000) } }));
  });

  it("does not overwrite a lost claim or hide completion failures", async () => {
    const deps = setup();
    vi.mocked(deps.work.complete).mockResolvedValueOnce({ success: true, data: "claim_lost" });
    expect(await storeMessageImage(job, deps)).toEqual({ success: true, data: "claim_lost" });
    vi.mocked(deps.work.complete).mockResolvedValueOnce({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE", message: "database down" } });
    expect(await storeMessageImage(job, deps)).toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
  });

  it("links an already completed import without downloading or uploading", async () => {
    const deps = setup();
    vi.mocked(deps.findCompletedImport).mockResolvedValueOnce({ success: true, data: { id: "image-1" } });
    expect(await storeMessageImage(job, deps)).toEqual({ success: true, data: "stored" });
    expect(deps.findCompletedImport).toHaveBeenCalledWith(`whatsapp-message:${job.messageId}`);
    expect(deps.download).not.toHaveBeenCalled();
    expect(deps.storage.uploadPrivate).not.toHaveBeenCalled();
    expect(deps.work.complete).toHaveBeenCalledWith(expect.objectContaining({ completion: { status: "ready", imageId: "image-1" } }));
  });

  it("propagates an import lookup failure without downloading", async () => {
    const deps = setup();
    const failure = { code: "PERSISTENCE_UNAVAILABLE", message: "database down" } as const;
    vi.mocked(deps.findCompletedImport).mockResolvedValueOnce({ success: false, error: failure });
    expect(await storeMessageImage(job, deps)).toEqual({ success: false, error: failure });
    expect(deps.download).not.toHaveBeenCalled();
  });
});
