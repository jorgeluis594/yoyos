import { ok, err } from "@shared/functional";
import { systemPrisma } from "@core/src/shared/infrastructure/persistance";
import type { AccessLoadError } from "@core/src/features/users/application/load-user-access";

export const userRepository = {
  async findUser(userId: string) {
    try {
      return ok(await systemPrisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, companyId: true } }));
    } catch (cause) {
      console.error("Unable to load authenticated user", cause);
      return err<AccessLoadError>({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to load user" });
    }
  },
};
