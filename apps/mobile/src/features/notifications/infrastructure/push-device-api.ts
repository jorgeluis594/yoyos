import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { registerPushDeviceRequestSchema, unregisterPushDeviceRequestSchema } from "@shared/contracts/push-devices";
import type { TransportError } from "@mobile/shared/application/transport-error";
import type { NoticeError, PushDeviceApi } from "../application/ports";

type Request = (path: string, init?: RequestInit) => Promise<Result<unknown, TransportError>>;

const unavailable = (message: string): NoticeError => ({ code: "NETWORK_ERROR", message });
const jsonInit = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export function createPushDeviceApi(request: Request, coreUrl: string, fetcher: typeof fetch = fetch): PushDeviceApi {
  return {
    register: async (input) => {
      const body = registerPushDeviceRequestSchema.safeParse(input);
      if (!body.success) return err({ code: "NOTICE_UNAVAILABLE", message: "Invalid push device" });
      const response = await request("/api/push-devices/current", jsonInit("PUT", body.data));
      return response.success ? ok(null) : err(unavailable(response.error.message));
    },
    unregister: async (token) => {
      const body = unregisterPushDeviceRequestSchema.safeParse({ version: 1, token });
      if (!body.success) return err({ code: "NOTICE_UNAVAILABLE", message: "Invalid push token" });
      try {
        const response = await fetcher(`${coreUrl}/api/push-devices/unregister`, jsonInit("POST", body.data));
        return response.status === 204 ? ok(null) : err(unavailable(`Unregister answered ${response.status}`));
      } catch {
        return err(unavailable("Unable to reach the server"));
      }
    },
  };
}
