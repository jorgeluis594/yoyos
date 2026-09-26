import { ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { MessageImage } from "@core/src/features/chats/domain/message";
import type { DownloadedImage } from "@core/src/shared/images/application/images";

export type StoreImageDependencies = Readonly<{
  findCompletedImport: (sourceKey: string) => Promise<Result<{ id: string } | null>>;
  download: (mediaId: string) => Promise<Result<DownloadedImage>>;
  importImage: (sourceKey: string, file: DownloadedImage) => Promise<Result<{ id: string }>>;
}>;

export async function storeMessageImage(externalId: string, mediaId: string, deps: StoreImageDependencies): Promise<Result<MessageImage>> {
  const sourceKey = `whatsapp-message:${externalId}`;
  const prior = await deps.findCompletedImport(sourceKey);
  if (!prior.success) return prior;
  if (prior.data) return ok({ status: "ready", mediaId, imageId: prior.data.id });

  const downloaded = await deps.download(mediaId);
  if (!downloaded.success) {
    return ok({ status: "failed", mediaId, failure: { code: downloaded.error.code === "INVALID_MEDIA_RESPONSE" ? "INVALID_IMAGE" : "MEDIA_UNAVAILABLE", message: downloaded.error.message } });
  }
  const imported = await deps.importImage(sourceKey, downloaded.data);
  if (!imported.success) {
    if (imported.error.code === "INVALID_IMAGE" || imported.error.code === "IMAGE_TOO_LARGE") return ok({ status: "failed", mediaId, failure: { code: "INVALID_IMAGE", message: imported.error.message } });
    if (imported.error.code === "IMAGE_STORAGE_UNAVAILABLE" || imported.error.code === "IMAGE_STORAGE_CONFIG_ERROR") return ok({ status: "failed", mediaId, failure: { code: "IMAGE_STORAGE_UNAVAILABLE", message: imported.error.message } });
    return imported;
  }
  return ok({ status: "ready", mediaId, imageId: imported.data.id });
}
