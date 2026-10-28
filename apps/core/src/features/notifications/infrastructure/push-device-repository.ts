import { Prisma } from "@prisma/client";
import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { log } from "@core/src/shared/infrastructure/logger";
import { systemPrisma } from "@core/src/shared/infrastructure/persistance";
import { isPersistenceFailure } from "@core/src/shared/infrastructure/persistence-error";
import type { ExpoPushToken, PushDevice, PushDeviceId } from "@core/src/features/notifications/domain/push-device";
import type { RegisterPushDeviceDependencies } from "@core/src/features/notifications/application/register-push-device";
import type { NoticeError } from "@core/src/features/notifications/application/send-chat-message-notice";

type Unavailable = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;

export const pushDeviceRowSchema = z.object({
  id: z.uuid(),
  sessionId: z.string().min(1),
  userId: z.string().min(1),
  token: z.string().min(1),
  platform: z.enum(["ios", "android"]),
  locale: z.enum(["es", "pt-BR"]),
});

const unavailable: Unavailable = { code: "PERSISTENCE_UNAVAILABLE", message: "Push devices unavailable" };
const isTokenRace = (cause: unknown) => cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002";

/** Global table, no RLS: only these functions read it, always by session (joined to the user's company) or by token. */
export const pushDeviceRepository = {
  async save(device: Parameters<RegisterPushDeviceDependencies["save"]>[0]): ReturnType<RegisterPushDeviceDependencies["save"]> {
    const write = () => systemPrisma.$transaction(async (tx) => {
      const taken = await tx.pushDevice.deleteMany({ where: { token: device.token, sessionId: { not: device.sessionId } } });
      const data = { userId: device.userId, token: device.token, platform: device.platform, locale: device.locale };
      await tx.pushDevice.upsert({ where: { sessionId: device.sessionId }, create: { sessionId: device.sessionId, ...data }, update: data });
      return taken.count > 0;
    });
    try {
      try {
        return ok({ moved: await write() });
      } catch (cause) {
        // A concurrent registration of the same token won the unique index; the loser retries once.
        if (!isTokenRace(cause)) throw cause;
        return ok({ moved: await write() });
      }
    } catch (cause) {
      log.error({ event: "unable_to_register_push_device", err: cause }, "unable_to_register_push_device");
      return err(unavailable);
    }
  },

  async removeByToken(token: string): Promise<Result<null, Unavailable>> {
    try {
      await systemPrisma.pushDevice.deleteMany({ where: { token } });
      return ok(null);
    } catch (cause) {
      log.error({ event: "unable_to_unregister_push_device", err: cause }, "unable_to_unregister_push_device");
      return err(unavailable);
    }
  },

  /** The session must be unexpired and its user must belong to `companyId` now, not when the device registered. */
  async findForSession(sessionId: string, companyId: string): Promise<Result<PushDevice | null, NoticeError>> {
    try {
      const row = await systemPrisma.pushDevice.findFirst({
        where: { sessionId, session: { expiresAt: { gt: new Date() } }, user: { companyId } },
        select: { id: true, sessionId: true, userId: true, token: true, platform: true, locale: true },
      });
      if (!row) return ok(null);
      const parsed = pushDeviceRowSchema.safeParse(row);
      if (!parsed.success) {
        log.error({ event: "notifications_push_device_invalid", errorCode: "INVALID_STORED_DATA" }, "Invalid stored push device");
        return err({ code: "INVALID_STORED_DATA", message: "Invalid stored push device", retryable: false });
      }
      return ok({ ...parsed.data, id: parsed.data.id as PushDeviceId, token: parsed.data.token as ExpoPushToken });
    } catch (cause) {
      if (!isPersistenceFailure(cause)) throw cause;
      log.error({ event: "unable_to_find_push_device", err: cause }, "unable_to_find_push_device");
      return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Push devices unavailable", retryable: true });
    }
  },

  async remove(deviceId: PushDeviceId): Promise<Result<null, NoticeError>> {
    try {
      await systemPrisma.pushDevice.deleteMany({ where: { id: deviceId } });
      log.info({ event: "notifications_push_device_removed", reason: "device_not_registered" }, "notifications_push_device_removed");
      return ok(null);
    } catch (cause) {
      log.error({ event: "unable_to_remove_push_device", err: cause }, "unable_to_remove_push_device");
      return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Push devices unavailable", retryable: true });
    }
  },
};
