import { currentAccessDtoSchema } from "@shared/contracts/registration";
import { err } from "@shared/functional";
import type { TransportError } from "@/shared/application/transport-error";
import { toUserAccess } from "../application/user-access";
import type { UserAccess } from "../application/user-access";
import type { Result } from "@shared/result";

export function createAccessApi(request: (path: string) => Promise<Result<unknown, TransportError>>) {
  return async function readAccess(): Promise<Result<UserAccess, TransportError>> {
    const response = await request("/api/me");
    if (!response.success) return response;
    const parsed = currentAccessDtoSchema.safeParse(response.data);
    return parsed.success
      ? { success: true, data: toUserAccess(parsed.data) }
      : err({ code: "INVALID_RESPONSE", message: "Server returned invalid access data" });
  };
}
