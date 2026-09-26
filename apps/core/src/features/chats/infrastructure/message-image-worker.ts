import { randomUUID } from "node:crypto";
import { err, ok } from "@shared/functional";
import { prisma } from "@core/src/shared/infrastructure/persistance";
import { Prisma } from "@prisma/client";
import type { ImageWorkRepository } from "@core/src/features/chats/application/store-message-image";

function isPersistenceFailure(cause: unknown) {
  return cause instanceof Prisma.PrismaClientKnownRequestError
    || cause instanceof Prisma.PrismaClientUnknownRequestError
    || cause instanceof Prisma.PrismaClientInitializationError;
}

export const imageWorkRepository: ImageWorkRepository = {
  async claimNext({ now, leaseUntil, claimToken, maxAttempts }) {
    try {
      const rows = await prisma.$queryRaw<Array<{ id: string; whatsappMediaId: string; imageAttempts: number; previousStatus: string }>>`
        WITH exhausted AS (
          UPDATE "ChatMessage" SET "imageStatus" = 'failed', "imageNextAttemptAt" = NULL,
            "imageClaimToken" = NULL, "imageLeaseUntil" = NULL,
            "imageFailureCode" = 'RETRIES_EXHAUSTED', "imageFailureMessage" = 'Image processing retries exhausted'
          WHERE (
            ("imageStatus" = 'processing' AND "imageLeaseUntil" <= ${now})
            OR ("imageStatus" = 'pending' AND "imageNextAttemptAt" <= ${now})
          ) AND "imageAttempts" >= ${maxAttempts}
            AND NOT EXISTS (SELECT 1 FROM "Image" AS image WHERE image."companyId" = "ChatMessage"."companyId"
              AND image."sourceKey" = 'whatsapp-message:' || "ChatMessage"."id" AND image."visibility" = 'private' AND image."importStatus" = 'ready')
          RETURNING "id"
        ), candidate AS (
          SELECT "id", "imageStatus" AS "previousStatus" FROM "ChatMessage"
          WHERE "type" = 'image'
            AND ("imageAttempts" < ${maxAttempts} OR EXISTS (SELECT 1 FROM "Image" AS image WHERE image."companyId" = "ChatMessage"."companyId"
              AND image."sourceKey" = 'whatsapp-message:' || "ChatMessage"."id" AND image."visibility" = 'private' AND image."importStatus" = 'ready'))
            AND (("imageStatus" = 'pending' AND "imageNextAttemptAt" <= ${now})
              OR ("imageStatus" = 'processing' AND "imageLeaseUntil" <= ${now}))
          ORDER BY COALESCE("imageNextAttemptAt", "imageLeaseUntil"), "id"
          FOR UPDATE SKIP LOCKED LIMIT 1
        )
        UPDATE "ChatMessage" AS message SET "imageStatus" = 'processing',
          "imageAttempts" = message."imageAttempts" + 1, "imageNextAttemptAt" = NULL,
          "imageClaimToken" = ${claimToken}, "imageLeaseUntil" = ${leaseUntil}
        FROM candidate WHERE message."id" = candidate."id"
        RETURNING message."id", message."whatsappMediaId", message."imageAttempts", candidate."previousStatus"
      `;
      const row = rows[0];
      return ok(row ? { messageId: row.id, mediaId: row.whatsappMediaId, claimToken, attempts: row.imageAttempts, leaseUntil, reclaimed: row.previousStatus === "processing" } : null);
    } catch (cause) {
      if (!isPersistenceFailure(cause)) throw cause;
      console.error("Unable to claim WhatsApp image", { error: cause.name });
      return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to claim image work" });
    }
  },
  async complete({ messageId, claimToken, completion }) {
    try {
      const data = completion.status === "ready"
        ? { imageStatus: "ready" as const, imageId: completion.imageId, imageClaimToken: null, imageLeaseUntil: null, imageFailureCode: null, imageFailureMessage: null }
        : completion.status === "pending"
          ? { imageStatus: "pending" as const, imageNextAttemptAt: completion.nextAttemptAt, imageClaimToken: null, imageLeaseUntil: null }
          : { imageStatus: "failed" as const, imageFailureCode: completion.failure.code, imageFailureMessage: completion.failure.message, imageNextAttemptAt: null, imageClaimToken: null, imageLeaseUntil: null };
      const result = await prisma.chatMessage.updateMany({ where: { id: messageId, imageStatus: "processing", imageClaimToken: claimToken }, data });
      return ok(result.count ? "updated" : "claim_lost");
    } catch (cause) {
      if (!isPersistenceFailure(cause)) throw cause;
      console.error("Unable to complete WhatsApp image", { error: cause.name });
      return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to complete image work" });
    }
  },
};

export function newImageClaimToken() { return randomUUID(); }
