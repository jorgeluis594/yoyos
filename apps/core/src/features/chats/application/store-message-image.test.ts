import { describe, expect, it, vi } from "vitest";
import type { Result } from "@shared/result";
import { storeMessageImage, type StoreImageDependencies } from "@core/src/features/chats/application/store-message-image";

const job = { companyId: "7b1d7be7-14bd-4b74-aecd-9fb56d8b64a0", messageId: "2e98e108-1821-4fd1-a507-21e3e00b76f1", mediaId: "media-1", claimToken: "claim-1", attempts: 1, leaseUntil: new Date(10_000) };
function setup(): StoreImageDependencies {
  const complete = vi.fn(async (): Promise<Result<"updated" | "claim_lost">> => ({ success: true, data: "updated" }));
  return {
    download: vi.fn(async () => ({ success: false as const, error: { code: "MEDIA_UNAVAILABLE", message: "temporary" } })),
    storage: { upload: vi.fn(), uploadPrivate: vi.fn(), readPrivate: vi.fn(), getUrl: vi.fn(), delete: vi.fn() },
    images: { create: vi.fn(), find: vi.fn(), reserveImport: vi.fn(), completeImport: vi.fn() },
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
});
