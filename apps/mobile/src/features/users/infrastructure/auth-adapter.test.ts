import { createAuthAdapter, type AuthClientBoundary, type SecureSessionStorage } from "./auth-adapter";

const response = (data: unknown, error: unknown = null) => ({ data, error });
const session = { session: { id: "session-1", expiresAt: new Date("2030-01-01T00:00:00Z") }, user: { id: "user-1", email: "a@example.com" } };
const token = (exp: number) => `e30.${btoa(JSON.stringify({ exp })).replace(/=/g, "")}.sig`;

function storage(): SecureSessionStorage {
  const values = new Map<string, string>();
  return {
    getItemAsync: async (key) => values.get(key) ?? null,
    setItemAsync: async (key, value) => { values.set(key, value); },
    deleteItemAsync: async (key) => { values.delete(key); },
  };
}

test("login validates Better Auth output, renews the server session, then keeps the JWT in memory", async () => {
  const calls: string[] = [];
  const client: AuthClientBoundary = {
    signIn: async () => { calls.push("sign-in"); return response({ user: { id: "user-1" } }); },
    getSession: async () => { calls.push("session"); return response(session); },
    token: async () => { calls.push("token"); return response({ token: token(1000) }); },
    signOut: async () => response({ success: true }),
  };
  const auth = createAuthAdapter(client, storage(), { now: () => 0 });
  expect(await auth.signIn({ email: "a@example.com", password: "password" })).toEqual({ success: true, data: undefined });
  expect(await auth.getToken()).toEqual({ success: true, data: token(1000) });
  expect(calls).toEqual(["sign-in", "session", "token"]);
});

test("maps incorrect credentials to the stable login error", async () => {
  const client: AuthClientBoundary = {
    signIn: async () => response(null, { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password", status: 401 }),
    getSession: async () => response(null), token: async () => response(null), signOut: async () => response({ success: true }),
  };
  const auth = createAuthAdapter(client, storage());
  expect(await auth.signIn({ email: "a@example.com", password: "wrong" })).toMatchObject({
    success: false, error: { code: "INVALID_CREDENTIALS" },
  });
});

test("rejects incompatible SDK responses instead of treating them as absent sessions", async () => {
  const invalidSignIn: AuthClientBoundary = {
    signIn: async () => response({ user: { id: "" } }),
    getSession: async () => response(session), token: async () => response({ token: token(1000) }),
    signOut: async () => response({ success: true }),
  };
  expect(await createAuthAdapter(invalidSignIn, storage(), { now: () => 0 }).signIn({ email: "a@example.com", password: "password" }))
    .toMatchObject({ success: false, error: { code: "INVALID_RESPONSE" } });

  const invalidSession: AuthClientBoundary = {
    signIn: async () => response({ user: { id: "user-1" } }),
    getSession: async () => response({ session: { id: "", expiresAt: "later" }, user: {} }),
    token: async () => response({ token: token(1000) }), signOut: async () => response({ success: true }),
  };
  expect(await createAuthAdapter(invalidSession, storage()).restoreSession())
    .toMatchObject({ success: false, error: { code: "INVALID_RESPONSE" } });
});

test("coalesces JWT refresh and discards a result after logout invalidates it", async () => {
  let release!: (value: unknown) => void;
  let sessionCalls = 0;
  const client: AuthClientBoundary = {
    signIn: async () => response({ user: { id: "user-1" } }),
    getSession: async () => { sessionCalls++; return new Promise((resolve) => { release = resolve; }); },
    token: async () => response({ token: token(1000) }),
    signOut: async () => response({ success: true }),
  };
  const auth = createAuthAdapter(client, storage(), { now: () => 0 });
  const first = auth.renewToken();
  const second = auth.renewToken();
  expect(sessionCalls).toBe(1);
  auth.invalidate();
  release(response(session));
  expect(await first).toMatchObject({ success: false, error: { code: "OPERATION_CANCELLED" } });
  expect(await second).toMatchObject({ success: false, error: { code: "OPERATION_CANCELLED" } });
});

test("a late sign-in response cannot restore credentials after logout", async () => {
  let finishSignIn!: (value: unknown) => void;
  let sessionReads = 0;
  const client: AuthClientBoundary = {
    signIn: async () => new Promise((resolve) => { finishSignIn = resolve; }),
    getSession: async () => { sessionReads++; return response(session); },
    token: async () => response({ token: token(1000) }),
    signOut: async () => response({ success: true }),
  };
  const auth = createAuthAdapter(client, storage(), { now: () => 0 });
  const signingIn = auth.signIn({ email: "a@example.com", password: "password" });
  auth.invalidate();
  finishSignIn(response({ user: { id: "user-1" } }));
  expect(await signingIn).toMatchObject({ success: false, error: { code: "OPERATION_CANCELLED" } });
  expect(sessionReads).toBe(0);
  expect(await auth.getToken()).toMatchObject({ success: false, error: { code: "OPERATION_CANCELLED" } });
});

test("failed SecureStore deletion blocks session restoration", async () => {
  const client: AuthClientBoundary = {
    signIn: async () => response({ user: { id: "user-1" } }),
    getSession: async () => response(null),
    token: async () => response({ token: token(1000) }),
    signOut: async () => response({ success: true }),
  };
  const failingStore: SecureSessionStorage = {
    getItemAsync: async () => null,
    setItemAsync: async () => {},
    deleteItemAsync: async () => { throw new Error("keychain failed"); },
  };
  const auth = createAuthAdapter(client, failingStore);
  expect(await auth.clearLocalSession()).toMatchObject({ success: false, error: { code: "SECURE_STORAGE_ERROR" } });
  expect(await auth.restoreSession()).toMatchObject({ success: false, error: { code: "SECURE_STORAGE_ERROR" } });
});

test("remote logout is bounded when the server never responds", async () => {
  const client: AuthClientBoundary = {
    signIn: async () => response({ user: { id: "user-1" } }),
    getSession: async () => response(null), token: async () => response(null),
    signOut: async () => new Promise(() => {}),
  };
  const auth = createAuthAdapter(client, storage(), { logoutTimeoutMs: 1 });
  const result = await auth.revokeSession();
  expect(result).toMatchObject({ success: false, error: { code: "NETWORK_ERROR" } });
});

test("logout clears SDK cookie chunks and the in-memory access token", async () => {
  const values = new Map<string, string>([
    ["yoyos_mobile_cookie", "\u0001ba-chunks:2:0:1"],
    ["yoyos_mobile_cookie.0.0", "chunk-a"],
    ["yoyos_mobile_cookie.0.1", "chunk-b"],
    ["yoyos_mobile_cookie.1.0", "old-chunk"],
    ["yoyos_mobile_session_data", "{}"],
  ]);
  const removed: string[] = [];
  const secureStore: SecureSessionStorage = {
    getItemAsync: async (key) => values.get(key) ?? null,
    setItemAsync: async (key, value) => { values.set(key, value); },
    deleteItemAsync: async (key) => { removed.push(key); values.delete(key); },
  };
  let active = true;
  const client: AuthClientBoundary = {
    signIn: async () => response({ user: { id: "user-1" } }),
    getSession: async () => response(active ? session : null),
    token: async () => response({ token: token(1000) }),
    signOut: async () => { active = false; return response({ success: true }); },
  };
  const auth = createAuthAdapter(client, secureStore, { now: () => 0 });
  expect((await auth.signIn({ email: "a@example.com", password: "password" })).success).toBe(true);
  auth.invalidate();
  expect((await auth.revokeSession()).success).toBe(true);
  expect(await auth.clearLocalSession()).toMatchObject({ success: true });
  expect(removed).toEqual([
    "yoyos_mobile_cookie.0.0", "yoyos_mobile_cookie.0.1", "yoyos_mobile_cookie.1.0",
    "yoyos_mobile_cookie", "yoyos_mobile_session_data",
  ]);
  expect(await auth.getToken()).toMatchObject({ success: false, error: { code: "UNAUTHENTICATED" } });
});
