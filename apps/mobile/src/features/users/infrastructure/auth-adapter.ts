import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { z } from "zod";
import type { TransportError } from "@mobile/shared/application/transport-error";
import type { AccountError, MobileAuth, RegisterAccountInput, SignInInput } from "../application/contracts";
import { authGeneration } from "@mobile/shared/infrastructure/auth-generation";

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
  signUp: (input: RegisterAccountInput & Readonly<{ callbackURL: string }>) => Promise<unknown>;
  signIn: (input: SignInInput) => Promise<unknown>;
  sendVerificationEmail?: (input: Readonly<{ email: string; callbackURL: string }>) => Promise<unknown>;
  requestPasswordReset?: (input: Readonly<{ email: string; redirectTo: string }>) => Promise<unknown>;
  getSession: (signal?: AbortSignal) => Promise<unknown>;
  token: (signal?: AbortSignal) => Promise<unknown>;
  signOut: (signal: AbortSignal) => Promise<unknown>;
}>;
export type SecureSessionStorage = Readonly<{
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
  deleteItemAsync: (key: string) => Promise<void>;
}>;

function mapSdkError(value: unknown, operation: "register" | "login" = "login"): AccountError {
  const parsed = sdkErrorSchema.safeParse(value);
  if (!parsed.success) return { code: "INVALID_RESPONSE", message: "Authentication returned an invalid error" };
  if (parsed.data.code === "EMAIL_NOT_VERIFIED") return { code: "EMAIL_NOT_VERIFIED", message: "Verify your email before signing in" };
  if (["PASSWORD_TOO_SHORT", "PASSWORD_TOO_LONG", "INVALID_EMAIL"].includes(parsed.data.code ?? "") ||
      (operation === "register" && parsed.data.code === "INVALID_PASSWORD")) {
    return { code: "INVALID_INPUT", message: "Account details are invalid" };
  }
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
  options: Readonly<{ now?: () => number; logoutTimeoutMs?: number; accountVerificationUrl?: string; passwordResetRedirectTo?: string }> = {},
): Readonly<MobileAuth & {
  getToken: () => Promise<Result<string, TransportError>>;
  renewToken: () => Promise<Result<string, TransportError>>;
  generation: () => number;
  invalidate: () => void;
}> {
  const now = options.now ?? Date.now;
  const logoutTimeoutMs = options.logoutTimeoutMs ?? 5000;
  const accountVerificationUrl = options.accountVerificationUrl ?? "http://localhost:3000/account-verified";
  const passwordResetRedirectTo = options.passwordResetRedirectTo ?? "http://localhost:3000/reset-password";
  let accessToken: string | null = null;
  let tokenExpiresAt = 0;
  let refreshing: Promise<Result<string, TransportError>> | null = null;
  let restoreBlocked = false;
  let logoutPending = false;

  const loadToken = async (signal?: AbortSignal): Promise<Result<string, TransportError>> => {
    const generation = authGeneration.get();
    try {
      const sessionResponse = await client.getSession(signal);
      const sessionResult = readResult(sessionResponse === null ? { data: null, error: null } : sessionResponse);
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
    async registerAccount(input) {
      const generation = authGeneration.advance();
      refreshing = null;
      accessToken = null;
      logoutPending = false;
      try {
        const result = readResult(await client.signUp({ ...input, callbackURL: accountVerificationUrl }));
        if (generation !== authGeneration.get()) return err({ code: "OPERATION_CANCELLED", message: "Session changed" });
        if (!result.success) return result;
        if (result.data.error) return err(mapSdkError(result.data.error, "register"));
        if (!signInDataSchema.safeParse(result.data.data).success) return err({ code: "INVALID_RESPONSE", message: "Authentication returned an invalid registration" });
        return ok(undefined);
      } catch {
        return err({ code: "NETWORK_ERROR", message: "Unable to register account" });
      }
    },
    async requestVerification(input) {
      const email = z.email().safeParse(input.email);
      if (!email.success) return err({ code: "INVALID_INPUT", message: "Invalid email address" });
      try {
        const result = readResult(await client.sendVerificationEmail?.({ email: email.data, callbackURL: accountVerificationUrl }));
        if (!result.success) return result;
        const accepted = z.object({ status: z.literal(true) }).safeParse(result.data.data);
        return result.data.error || !accepted.success ? err(mapSdkError(result.data.error ?? { code: "INVALID_RESPONSE" })) : ok(undefined);
      } catch { return err({ code: "NETWORK_ERROR", message: "Unable to request verification email" }); }
    },
    async requestPasswordReset(input) {
      const email = z.email().safeParse(input.email);
      if (!email.success) return err({ code: "INVALID_INPUT", message: "Invalid email address" });
      try {
        const result = readResult(await client.requestPasswordReset?.({ email: email.data, redirectTo: passwordResetRedirectTo }));
        if (!result.success) return result;
        const accepted = z.object({ status: z.literal(true) }).safeParse(result.data.data);
        return result.data.error || !accepted.success ? err(mapSdkError(result.data.error ?? { code: "INVALID_RESPONSE" })) : ok(undefined);
      } catch { return err({ code: "NETWORK_ERROR", message: "Unable to request password reset" }); }
    },
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
        const sessionResponse = await client.getSession();
        const result = readResult(sessionResponse === null ? { data: null, error: null } : sessionResponse);
        if (!result.success) {
          if (__DEV__) console.warn("[auth] get-session SDK result invalid", { code: result.error.code, message: result.error.message });
          return result;
        }
        if (__DEV__) {
          const payload = result.data.data;
          const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
          const keys = (value: unknown) => value && typeof value === "object" ? Object.keys(value) : typeof value;
          const error = result.data.error === null ? null : sdkErrorSchema.safeParse(result.data.error);
          console.info("[auth] get-session response", {
            data: payload === null ? null : {
              keys: keys(payload),
              sessionKeys: keys(record?.session),
              userKeys: keys(record?.user),
              validSession: sessionSchema.safeParse(payload).success,
            },
            error: error === null ? null : error.success ? { code: error.data.code, status: error.data.status } : "unrecognized",
          });
        }
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
