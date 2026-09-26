import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { ImageFailure } from "@core/src/features/chats/domain/message";
import type { DownloadedImage, ImageStorage } from "@core/src/shared/images/application/images";

export type ClaimedMessageImage = Readonly<{ messageId: string; mediaId: string; claimToken: string; attempts: number; leaseUntil: Date; reclaimed?: boolean }>;
export type ImageWorkCompletion = Readonly<{ status: "ready"; imageId: string }> | Readonly<{ status: "pending"; nextAttemptAt: Date }> | Readonly<{ status: "failed"; failure: ImageFailure }>;
export type ImageWorkRepository = Readonly<{
  claimNext: (input: Readonly<{ now: Date; leaseUntil: Date; claimToken: string; maxAttempts: number }>) => Promise<Result<ClaimedMessageImage | null>>;
  complete: (input: Readonly<{ messageId: string; claimToken: string; completion: ImageWorkCompletion }>) => Promise<Result<"updated" | "claim_lost">>;
}>;
export type StoreImageDependencies = Readonly<{
  download: (mediaId: string) => Promise<Result<DownloadedImage>>;
  storage: ImageStorage;
  findCompletedImport: (sourceKey: string) => Promise<Result<{ id: string } | null>>;
  importImage: (sourceKey: string, file: DownloadedImage) => Promise<Result<{ id: string }>>;
  work: ImageWorkRepository;
  now: () => Date;
  retryDelaysMs: readonly number[];
}>;

export async function storeMessageImage(job: ClaimedMessageImage, deps: StoreImageDependencies): Promise<Result<"stored" | "retry_scheduled" | "failed" | "claim_lost">> {
  const sourceKey = `whatsapp-message:${job.messageId}`;
  const imported = await deps.findCompletedImport(sourceKey);
  if (!imported.success) return imported;
  let completion: Parameters<ImageWorkRepository["complete"]>[0]["completion"];
  if (imported.data) {
    completion = { status: "ready", imageId: imported.data.id };
  } else {
    const downloaded = await deps.download(job.mediaId);
    if (!downloaded.success) {
      const delay = downloaded.error.code === "INVALID_MEDIA_RESPONSE" ? undefined : deps.retryDelaysMs[job.attempts - 1];
      completion = delay === undefined
        ? { status: "failed", failure: { code: downloaded.error.code === "INVALID_MEDIA_RESPONSE" ? "INVALID_IMAGE" : "RETRIES_EXHAUSTED", message: downloaded.error.message } }
        : { status: "pending", nextAttemptAt: new Date(deps.now().getTime() + delay) };
    } else {
      const stored = await deps.importImage(sourceKey, downloaded.data);
      if (stored.success) completion = { status: "ready", imageId: stored.data.id };
      else if (stored.error.code === "INVALID_IMAGE" || stored.error.code === "IMAGE_TOO_LARGE") completion = { status: "failed", failure: { code: "INVALID_IMAGE", message: stored.error.message } };
      else if (stored.error.code === "IMAGE_STORAGE_UNAVAILABLE" || stored.error.code === "IMAGE_STORAGE_CONFIG_ERROR") {
        const delay = deps.retryDelaysMs[job.attempts - 1];
        completion = delay === undefined
          ? { status: "failed", failure: { code: "RETRIES_EXHAUSTED", message: "Image storage retries exhausted" } }
          : { status: "pending", nextAttemptAt: new Date(deps.now().getTime() + delay) };
      }
      else return err(stored.error);
    }
  }
  const completed = await deps.work.complete({ messageId: job.messageId, claimToken: job.claimToken, completion });
  if (!completed.success) return completed;
  if (completed.data === "claim_lost") return ok("claim_lost");
  return ok(completion.status === "ready" ? "stored" : completion.status === "pending" ? "retry_scheduled" : "failed");
}
