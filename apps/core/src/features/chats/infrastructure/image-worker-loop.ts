import { withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { imageRepository } from "@core/src/shared/images/infrastructure/image-repository";
import { createR2ImageStorage } from "@core/src/shared/images/infrastructure/r2-image-storage";
import { storeMessageImage } from "@core/src/features/chats/application/store-message-image";
import { imageWorkRepository, newImageClaimToken } from "@core/src/features/chats/infrastructure/message-image-worker";
import { downloadWhatsAppMedia } from "@core/src/features/chats/infrastructure/whatsapp-media";
import type { WhatsAppConnection } from "@core/src/features/chats/infrastructure/whatsapp-connections";

const storage = createR2ImageStorage({ endpoint: process.env.R2_ENDPOINT ?? "", bucket: process.env.R2_BUCKET ?? "", privateBucket: process.env.R2_PRIVATE_BUCKET ?? "", accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "", secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "", publicBaseUrl: process.env.R2_PUBLIC_BASE_URL ?? "" });
const retryDelaysMs = [60_000, 300_000, 1_800_000];
const leaseMs = 120_000;

export function startImageWorker(connections: readonly WhatsAppConnection[]) {
  if (!connections.length) return () => {};
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = async () => {
    if (stopped) return;
    for (const connection of connections) {
      try {
        const now = new Date();
        await withTenantIsolation(connection.companyId, async () => {
          const claim = await imageWorkRepository.claimNext({ companyId: connection.companyId, now, leaseUntil: new Date(now.getTime() + leaseMs), claimToken: newImageClaimToken(), maxAttempts: retryDelaysMs.length + 1 });
          if (!claim.success) { console.error("WhatsApp image claim failed", { companyId: connection.companyId }); return; }
          if (!claim.data) return;
          if (claim.data.reclaimed) console.warn("Reclaimed expired WhatsApp image reservation", { companyId: connection.companyId, messageId: claim.data.messageId, attempts: claim.data.attempts });
          const result = await storeMessageImage(claim.data, { download: (_companyId, mediaId) => downloadWhatsAppMedia(connection, mediaId), storage, images: imageRepository, work: imageWorkRepository, now: () => new Date(), retryDelaysMs });
          if (!result.success) console.error("WhatsApp image processing failed", { companyId: connection.companyId, messageId: claim.data.messageId, code: result.error.code });
          else if (result.data === "retry_scheduled" || result.data === "failed") console.info("WhatsApp image work updated", { companyId: connection.companyId, messageId: claim.data.messageId, status: result.data });
        });
      } catch (error) { console.error("WhatsApp image worker failed", { companyId: connection.companyId, error: error instanceof Error ? error.name : "unknown" }); }
    }
    timer = setTimeout(run, 1_000);
    timer.unref();
  };
  void run();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}
