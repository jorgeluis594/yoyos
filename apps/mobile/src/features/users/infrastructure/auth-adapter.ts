import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { z } from "zod";
import type { TransportError } from "@/shared/application/transport-error";
import type { AccountError, MobileAuth, SignInInput } from "../application/contracts";
import { authGeneration } from "@/shared/infrastructure/auth-generation";

const resultSchema = z.object({ data: z.unknown(), error: z.unknown().nullable().optional() });
const sdkErrorSchema = z.object({
  message: z.string().optional(), code: z.string().optional(), status: z.number().optional(),
}).passthrough();
const sessionSchema = z.object({
  session: z.object({ id: z.string().min(1), expiresAt: z.union([z.date(), z.iso.datetime()]) }),
  user: z.object({ id: z.string().min(1), email: z.email() }),
});
const signInDataSchema = z.object({ user: z.object({ id: z.string().min(1) }) }).passthrough();
const tokenDataSchema = z.object({ token: z.string().min(1) });
const claimsSchema = z.object({ exp: z.number().finite() }).passthrough();

export type AuthClientBoundary = Readonly<{
  signIn: (input: SignInInput) => Promise<unknown>;
  getSession: (signal?: AbortSignal) => Promise<unknown>;
  token: (signal?: AbortSignal) => Promise<unknown>;
  signOut: (signal: AbortSignal) => Promise<unknown>;
}>;
export type SecureSessionStorage = Readonly<{
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
  deleteItemAsync: (key: string) => Promise<void>;
}>;

function mapSdkError(value: unknown): AccountError {
  const parsed = sdkErrorSchema.safeParse(value);
  if (!parsed.success) return { code: "INVALID_RESPONSE", message: "Authentication returned an invalid error" };
  if (["INVALID_EMAIL_OR_PASSWORD", "INVALID_PASSWORD", "USER_NOT_FOUND"].includes(parsed.data.code ?? "")) {
    return { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect" };
  }
  if (parsed.data.status === 429) return { code: "RATE_LIMITED", message: "Too many attempts" };
  if ((parsed.data.status ?? 0) >= 500) return { code: "SERVER_ERROR", message: "Authentication service is unavailable" };
  return { code: "INVALID_RESPONSE", message: parsed.data.message ?? "Authentication failed" };
}

function readResult(value: unknown): Result<Readonly<{ data: unknown; error: unknown | null }>, TransportError> {
  const parsed = resultSchema.safeParse(value);
  return parsed.success
    ? ok({ data: parsed.data.data, error: parsed.data.error ?? null })
    : err({ code: "INVALID_RESPONSE", message: "Authentication returned an invalid response" });
}

function decodeExpiry(token: string, now: number): Result<string, TransportError> {
  try {
    const payload = token.split(".")[1];
    if (!payload) throw new Error("Missing JWT payload");
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const parsed = claimsSchema.safeParse(JSON.parse(globalThis.atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="))));
    if (!parsed.success || parsed.data.exp * 1000 <= now) throw new Error("Invalid JWT expiry");
    return ok(token);
  } catch {
    return err({ code: "INVALID_RESPONSE", message: "Authentication returned an invalid access token" });
  }
}

export function createAuthAdapter(
  client: AuthClientBoundary,
  storage: SecureSessionStorage,
  options: Readonly<{ now?: () => number; logoutTimeoutMs?: number }> = {},
): Readonly<MobileAuth & {
  getToken: () => Promise<Result<string, TransportError>>;
  renewToken: () => Promise<Result<string, TransportError>>;
  generation: () => number;
  invalidate: () => void;
}> {
  const now = options.now ?? Date.now;
  const logoutTimeoutMs = options.logoutTimeoutMs ?? 5000;
  let accessToken: string | null = null;
  let tokenExpiresAt = 0;
  let refreshing: Promise<Result<string, TransportError>> | null = null;
  let restoreBlocked = false;
  let logoutPending = false;

  const loadToken = async (signal?: AbortSignal): Promise<Result<string, TransportError>> => {
    const generation = authGeneration.get();
    try {
      const sessionResult = readResult(await client.getSession(signal));
      if (!sessionResult.success) return sessionResult;
      if (generation !== authGeneration.get()) return err({ code: "OPERATION_CANCELLED", message: "Session changed" });
      if (sessionResult.data.error) {
        const error = mapSdkError(sessionResult.data.error);
        return error.code === "INVALID_RESPONSE" ? err(error) : err({ code: "NETWORK_ERROR", message: "Unable to refresh authentication session" });
      }
      if (sessionResult.data.data === null) {
        accessToken = null;
        tokenExpiresAt = 0;
        return err({ code: "UNAUTHENTICATED", message: "No active session" });
      }
      const session = sessionSchema.safeParse(sessionResult.data.data);
      if (!session.success) return err({ code: "INVALID_RESPONSE", message: "Authentication returned an invalid session" });
      // Better Auth's Expo client awaits SecureStore writes before getSession resolves.
      const tokenResult = readResult(await client.token(signal));
      if (!tokenResult.success) return tokenResult;
      if (tokenResult.data.error) return err({ code: "NETWORK_ERROR", message: "Unable to renew access token" });
      const token = tokenDataSchema.safeParse(tokenResult.data.data);
      if (!token.success) return err({ code: "INVALID_RESPONSE", message: "Authentication returned an invalid token" });
      const checked = decodeExpiry(token.data.token, now());
      if (!checked.success) return checked;
      if (generation !== authGeneration.get()) return err({ code: "OPERATION_CANCELLED", message: "Session changed" });
      accessToken = checked.data;
      const payload = checked.data.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      const claims = claimsSchema.parse(JSON.parse(globalThis.atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, "="))));
      tokenExpiresAt = claims.exp * 1000;
      return checked;
    } catch {
      return err({ code: "NETWORK_ERROR", message: "Unable to refresh authentication session" });
    }
  };

  const renewToken = (): Promise<Result<string, TransportError>> => {
    if (refreshing) return refreshing;
    const pending = loadToken();
    refreshing = pending;
    void pending.finally(() => { if (refreshing === pending) refreshing = null; });
    return pending;
  };

  const getToken = async (): Promise<Result<string, TransportError>> => {
    if (restoreBlocked) return err({ code: "SECURE_STORAGE_ERROR", message: "Secure session storage needs to be cleared" });
    if (logoutPending) return err({ code: "OPERATION_CANCELLED", message: "Sign-out is in progress" });
    return accessToken && tokenExpiresAt > now() + 30_000 ? ok(accessToken) : renewToken();
  };

  return {
    async signIn(input) {
      const generation = authGeneration.advance();
      refreshing = null;
      accessToken = null;
      logoutPending = false;
      try {
        const result = readResult(await client.signIn(input));
        if (generation !== authGeneration.get()) return err({ code: "OPERATION_CANCELLED", message: "Session changed" });
        if (!result.success) return result;
        if (result.data.error) return err(mapSdkError(result.data.error));
        if (!signInDataSchema.safeParse(result.data.data).success) return err({ code: "INVALID_RESPONSE", message: "Authentication returned an invalid sign-in" });
        const token = await loadToken();
        return token.success ? ok(undefined) : err(token.error);
      } catch {
        return err({ code: "NETWORK_ERROR", message: "Unable to sign in" });
      }
    },
    async restoreSession() {
      if (restoreBlocked) return err({ code: "SECURE_STORAGE_ERROR", message: "Secure session storage needs to be cleared" });
      if (logoutPending) return err({ code: "OPERATION_CANCELLED", message: "Sign-out is in progress" });
      const generation = authGeneration.get();
      try {
        const result = readResult(await client.getSession());
        if (!result.success) return result;
        if (generation !== authGeneration.get()) return err({ code: "OPERATION_CANCELLED", message: "Session changed" });
        if (result.data.error) return err({ code: "NETWORK_ERROR", message: "Unable to restore session" });
        if (result.data.data === null) {
          accessToken = null;
          tokenExpiresAt = 0;
          return ok("absent");
        }
        if (!sessionSchema.safeParse(result.data.data).success) return err({ code: "INVALID_RESPONSE", message: "Authentication returned an invalid session" });
        const token = await renewToken();
        if (!token.success) return token.error.code === "UNAUTHENTICATED" ? ok("absent") : token;
        return generation === authGeneration.get() ? ok("active") : err({ code: "OPERATION_CANCELLED", message: "Session changed" });
      } catch {
        return err({ code: "NETWORK_ERROR", message: "Unable to restore session" });
      }
    },
    async revokeSession() {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<"timeout">((resolve) => { timer = setTimeout(() => { controller.abort(); resolve("timeout"); }, logoutTimeoutMs); });
        const revoke = client.signOut(controller.signal).then((value) => ({ kind: "result" as const, value }));
        const outcome = await Promise.race([revoke, timeout]);
        if (outcome === "timeout") return err({ code: "NETWORK_ERROR", message: "Remote sign-out was not confirmed" });
        const parsed = readResult(outcome.value);
        if (!parsed.success) return parsed;
        return parsed.data.error ? err({ code: "NETWORK_ERROR", message: "Remote sign-out was not confirmed" }) : ok(undefined);
      } catch {
        return err({ code: "NETWORK_ERROR", message: "Remote sign-out was not confirmed" });
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    async clearLocalSession() {
      try {
        const keys = ["yoyos_mobile_cookie", "yoyos_mobile_session_data"];
        for (const key of keys) {
          const value = await storage.getItemAsync(key);
          const marker = value?.startsWith("\u0001ba-chunks:") ? value.slice(11).split(":") : null;
          if (marker) {
            const count = Number(marker[0]);
            const slot = marker[1] === "0" || marker[1] === "1" ? Number(marker[1]) : null;
            const fallbackCount = marker[2] ? Number(marker[2]) : 0;
            const chunks = (chunkCount: number, chunkSlot: number | null) => Array.from({ length: chunkCount }, (_, index) =>
              chunkSlot === null ? `${key}.${index}` : `${key}.${chunkSlot}.${index}`);
            const chunkKeys = slot === null ? chunks(count, null) : [...chunks(count, slot), ...chunks(fallbackCount, 1 - slot)];
            for (const chunkKey of chunkKeys) await storage.deleteItemAsync(chunkKey);
          }
          await storage.deleteItemAsync(key);
        }
        restoreBlocked = false;
        logoutPending = false;
        return ok(undefined);
      } catch {
        restoreBlocked = true;
        return err({ code: "SECURE_STORAGE_ERROR", message: "Unable to clear secure session storage" });
      }
    },
    getToken,
    renewToken,
    generation: authGeneration.get,
    invalidate() {
      authGeneration.advance();
      accessToken = null;
      tokenExpiresAt = 0;
      refreshing = null;
      logoutPending = true;
    },
  };
}
