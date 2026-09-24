import { err, ok } from "@shared/functional";
import { restoreSession } from "./restore-session";
import { signIn } from "./sign-in";
import { signOut } from "./sign-out";

const access = { status: "company_required" as const, user: { id: "user-1", name: "A", companyId: null }, company: null };

test("validates login before effects and accepts pending-company access", async () => {
  let calls = 0;
  const dependencies = { signIn: async () => { calls++; return ok(undefined); }, readAccess: async () => ok(access) };
  expect((await signIn({ email: "bad", password: "pw" }, dependencies)).success).toBe(false);
  expect(calls).toBe(0);
  expect(await signIn({ email: "a@example.com", password: "password" }, dependencies)).toEqual(ok(access));
});

test("restore distinguishes absent sessions from network failures", async () => {
  expect(await restoreSession({ restoreSession: async () => ok("absent"), readAccess: async () => ok(access) })).toEqual(ok(null));
  const network = err({ code: "NETWORK_ERROR" as const, message: "offline" });
  expect(await restoreSession({ restoreSession: async () => ok("active"), readAccess: async () => network })).toEqual(network);
});

test("logout clears local state when remote revocation fails and reports storage failure", async () => {
  const order: string[] = [];
  const result = await signOut({
    invalidatePendingOperations: () => order.push("invalidate"),
    revokeSession: async () => { order.push("revoke"); return err({ code: "NETWORK_ERROR", message: "offline" }); },
    clearPrivateState: () => order.push("private"),
    clearLocalSession: async () => { order.push("storage"); return err({ code: "SECURE_STORAGE_ERROR", message: "locked" }); },
  });
  expect(result).toEqual(err({ code: "SECURE_STORAGE_ERROR", message: "locked" }));
  expect(order).toEqual(["invalidate", "revoke", "private", "storage"]);
});

test("offline logout succeeds locally and reports that remote revocation was not confirmed", async () => {
  const result = await signOut({
    invalidatePendingOperations: () => {},
    revokeSession: async () => err({ code: "NETWORK_ERROR" as const, message: "offline" }),
    clearPrivateState: () => {},
    clearLocalSession: async () => ok(undefined),
  });
  expect(result).toEqual(ok({ remoteRevocation: "unconfirmed" }));
});
