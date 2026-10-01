import { log } from "@core/src/shared/infrastructure/logger";
import { ok, err } from "@shared/functional";
import { systemPrisma } from "@core/src/shared/infrastructure/persistance";
import type { AccessLoadError } from "@core/src/features/users/application/load-user-access";

export const userRepository = {
  async findUser(userId: string) {
    try {
      return ok(await systemPrisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, emailVerified: true, companyId: true } }));
    } catch (cause) {
      log.error({ event: "unable_to_load_authenticated_user", err: cause }, "unable_to_load_authenticated_user");
      return err<AccessLoadError>({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to load user" });
    }
  },
};
