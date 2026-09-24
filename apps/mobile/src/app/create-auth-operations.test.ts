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
