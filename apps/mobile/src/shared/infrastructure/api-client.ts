import { err, ok } from "@shared/functional";
import { z } from "zod";
import type { Result } from "@shared/result";
import type { TransportError } from "@/shared/application/transport-error";
import { coreUrl } from "./core-url";

const apiErrorSchema = z.object({ code: z.string(), error: z.string() }).loose();

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
    const send = async (token: string) => {
      try {
        const response = await fetcher(`${coreUrl}${path}`, {
          ...init,
          headers: { ...Object.fromEntries(new Headers(init.headers)), authorization: `Bearer ${token}` },
        });
        if (__DEV__ && path === "/api/me") console.info(`[api] ${init.method ?? "GET"} ${coreUrl}${path} -> ${response.status}`);
        return response;
      } catch (cause) {
        if (__DEV__ && path === "/api/me") console.warn(`[api] ${init.method ?? "GET"} ${coreUrl}${path} failed`, cause);
        throw cause;
      }
    };
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
        const parsed = apiErrorSchema.safeParse(body);
        if (!parsed.success) return err({ code: "INVALID_RESPONSE", message: "Server returned an invalid error" });
        const knownCodes: TransportError["code"][] = ["UNAUTHENTICATED", "COMPANY_REQUIRED", "INVALID_COMPANY", "INVALID_IMAGE", "IMAGE_TOO_LARGE", "UNSUPPORTED_MEDIA_TYPE", "IMAGE_STORAGE_UNAVAILABLE", "NOT_FOUND", "SERVICE_UNAVAILABLE"];
        const code: TransportError["code"] = response.status === 429 ? "RATE_LIMITED"
          : parsed.data.code === "INTERNAL_ERROR" ? "SERVER_ERROR"
          : knownCodes.includes(parsed.data.code as TransportError["code"]) ? parsed.data.code as TransportError["code"] : "API_ERROR";
        return err({ code, message: parsed.data.error, http: { status: response.status, body } });
      }
      return ok(body);
    } catch {
      return err({ code: "NETWORK_ERROR", message: "Unable to reach the server" });
    }
  };
}
