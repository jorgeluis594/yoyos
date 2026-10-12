import { err } from "@shared/functional";
import type { Result } from "@shared/result";
import type { DownloadedImage, WhatsAppError } from "@mobile/modules/whatsapp/types";
import type { MessageStore, StoreError, WhatsAppGateway } from "@mobile/features/whatsapp/application/ports";
import type { CompanyId, NativeMessageId } from "@mobile/features/whatsapp/domain/ids";

export type ViewImageError = StoreError | WhatsAppError | Readonly<{ code: "NOT_FOUND"; message: string }>;

/** UC-05. The download reference never leaves the phone; the lookup is scoped to the session company. */
export function viewImage(deps: Readonly<{ store: Pick<MessageStore, "findImage">; whatsapp: Pick<WhatsAppGateway, "downloadImage"> }>):
  (companyId: CompanyId, id: NativeMessageId) => Promise<Result<DownloadedImage, ViewImageError>> {
  return async (companyId, id) => {
    const found = await deps.store.findImage(companyId, id);
    if (!found.success) return found;
    if (!found.data) return err({ code: "NOT_FOUND", message: "Image not found" });
    return deps.whatsapp.downloadImage({ messageId: found.data.messageId, downloadReference: found.data.reference });
  };
}

export function releaseImage(deps: Readonly<{ whatsapp: Pick<WhatsAppGateway, "deleteDownloadedImage"> }>):
  (id: NativeMessageId) => Promise<Result<void, WhatsAppError>> {
  return (id) => deps.whatsapp.deleteDownloadedImage(id);
}
