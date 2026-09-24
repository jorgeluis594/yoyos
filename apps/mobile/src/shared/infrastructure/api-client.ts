import { err, ok } from "@shared/functional";
import { apiErrorResponseSchema } from "@shared/contracts/registration";
import type { Result } from "@shared/result";
import type { TransportError } from "@/shared/application/transport-error";
import { coreUrl } from "./core-url";

export type SessionTransport = Readonly<{
  getToken: () => Promise<Result<string, TransportError>>;
  renewToken: () => Promise<Result<string, TransportError>>;
  generation: () => number;
}>;

export function createApiClient(session: SessionTransport, fetcher: typeof fetch = fetch) {
  return async function request(path: string, init: RequestInit = {}): Promise<Result<unknown, TransportError>> {
    const generation = session.generation();
    const firstToken = await session.getToken();
    if (!firstToken.success) return firstToken;
    const send = (token: string) => fetcher(`${coreUrl}${path}`, {
      ...init,
      headers: { ...Object.fromEntries(new Headers(init.headers)), authorization: `Bearer ${token}` },
    });
    try {
      let response = await send(firstToken.data);
      if (generation !== session.generation()) return err({ code: "OPERATION_CANCELLED", message: "Session changed" });
      if (response.status === 401) {
        const currentToken = await session.getToken();
        if (!currentToken.success) return currentToken;
        const renewed = currentToken.data === firstToken.data ? await session.renewToken() : currentToken;
        if (!renewed.success) return renewed;
        if (generation !== session.generation()) return err({ code: "OPERATION_CANCELLED", message: "Session changed" });
        response = await send(renewed.data);
        if (generation !== session.generation()) return err({ code: "OPERATION_CANCELLED", message: "Session changed" });
      }
      let body: unknown;
      try { body = await response.json(); }
      catch { return err({ code: "INVALID_RESPONSE", message: "Server returned invalid JSON" }); }
      if (!response.ok) {
        const parsed = apiErrorResponseSchema.safeParse(body);
        if (!parsed.success) return err({ code: "INVALID_RESPONSE", message: "Server returned an invalid error" });
        const code: TransportError["code"] = parsed.data.code === "UNAUTHENTICATED" ? "UNAUTHENTICATED"
          : parsed.data.code === "COMPANY_REQUIRED" ? "COMPANY_REQUIRED"
            : parsed.data.code === "INVALID_COMPANY" ? "INVALID_COMPANY"
            : response.status === 429 ? "RATE_LIMITED"
              : response.status >= 500 ? "SERVER_ERROR" : "INVALID_RESPONSE";
        return err({ code, message: parsed.data.error });
      }
      return ok(body);
    } catch {
      return err({ code: "NETWORK_ERROR", message: "Unable to reach the server" });
    }
  };
}
