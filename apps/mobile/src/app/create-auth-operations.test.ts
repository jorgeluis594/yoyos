import { createAuthOperations } from "./create-auth-operations";
import type { AuthClientBoundary, SecureSessionStorage } from "@/features/users/infrastructure/auth-adapter";

test("composes the auth adapter, JWT HTTP client, and /me adapter", async () => {
  const values = new Map<string, string>();
  const storage: SecureSessionStorage = {
    getItemAsync: async (key) => values.get(key) ?? null,
    setItemAsync: async (key, value) => { values.set(key, value); },
    deleteItemAsync: async (key) => { values.delete(key); },
  };
  const session = {
    session: { id: "session-1", expiresAt: "2100-01-01T00:00:00.000Z" },
    user: { id: "user-1", email: "a@example.com" },
  };
  const jwt = `e30.${btoa(JSON.stringify({ exp: 4_102_444_800 })).replace(/=/g, "")}.sig`;
  const client: AuthClientBoundary = {
    signUp: async () => ({ data: { user: { id: "user-1" } }, error: null }),
    signIn: async () => {
      await storage.setItemAsync("yoyos_mobile_cookie", "sdk-cookie");
      return { data: { user: { id: "user-1" } }, error: null };
    },
    getSession: async () => ({ data: session, error: null }),
    token: async () => ({ data: { token: jwt }, error: null }),
    signOut: async () => ({ data: { success: true }, error: null }),
  };
  const requests: string[] = [];
  const operations = createAuthOperations(client, storage, async (input, init) => {
    requests.push(new Headers(init?.headers).get("authorization") ?? "");
    expect(input).toBe("http://localhost:3000/api/me");
    return Response.json({
      status: "ready",
      user: { id: "user-1", name: "A", companyId: "00000000-0000-4000-8000-000000000001" },
      company: { id: "00000000-0000-4000-8000-000000000001", name: "Company", country: "PE" },
    });
  });

  const result = await operations.signIn({ email: "a@example.com", password: "password" });
  expect(result).toMatchObject({ success: true, data: { status: "ready", user: { id: "user-1" } } });
  expect(values.get("yoyos_mobile_cookie")).toBe("sdk-cookie");
  expect(requests).toEqual([`Bearer ${jwt}`]);
});

test("registration and recovery use the real auth, access, and company adapters", async () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const session = { session: { id: "session-1", expiresAt: "2100-01-01T00:00:00.000Z" }, user: { id: "user-1", email: "a@example.com" } };
  const jwt = `e30.${btoa(JSON.stringify({ exp: 4_102_444_800 })).replace(/=/g, "")}.sig`;
  let registrations = 0;
  let companyWrites = 0;
  let linked = false;
  let dropCompanyResponse = true;
  const client: AuthClientBoundary = {
    signUp: async () => { registrations++; return { data: { user: { id: "user-1" } }, error: null }; },
    signIn: async () => ({ data: { user: { id: "user-1" } }, error: null }),
    getSession: async () => ({ data: session, error: null }),
    token: async () => ({ data: { token: jwt }, error: null }),
    signOut: async () => ({ data: { success: true }, error: null }),
  };
  const storage: SecureSessionStorage = { getItemAsync: async () => null, setItemAsync: async () => {}, deleteItemAsync: async () => {} };
  const operations = createAuthOperations(client, storage, async (path, init) => {
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${jwt}`);
    if (String(path).endsWith("/api/me")) return Response.json(linked
      ? { status: "ready", user: { id: "user-1", name: "A", companyId: id }, company: { id, name: "Company", country: "PE" } }
      : { status: "company_required", user: { id: "user-1", name: "A", companyId: null }, company: null });
    expect(path).toBe("http://localhost:3000/api/company");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ name: "Company", country: "PE" });
    companyWrites++;
    linked = true;
    if (dropCompanyResponse) { dropCompanyResponse = false; throw new Error("response lost"); }
    return Response.json({ companyId: id }, { status: 200 });
  });
  const input = { account: { name: "A", email: "a@example.com", password: "password123" }, company: { name: " Company ", country: "PE" as const } };
  expect(await operations.register(input)).toMatchObject({ success: false, error: { step: "company", recovery: "reload_access_then_complete_company", cause: { code: "NETWORK_ERROR" } } });
  expect(await operations.restoreSession()).toMatchObject({ success: true, data: { status: "ready", company: { id } } });
  expect(await operations.completeCompany(input.company)).toMatchObject({ success: true, data: { status: "ready", company: { id } } });
  expect(registrations).toBe(1);
  expect(companyWrites).toBe(2);
});
