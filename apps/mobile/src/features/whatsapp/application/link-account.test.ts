import { err, ok } from "@shared/functional";
import { linkAccount, unlinkAccount } from "@mobile/features/whatsapp/application/link-account";
import type { LinkStore, Session } from "@mobile/features/whatsapp/application/ports";
import type { CompanyId, LinkId, UserId } from "@mobile/features/whatsapp/domain/ids";
import type { WhatsAppLink } from "@mobile/features/whatsapp/domain/link";

const session: Session = { companyId: "c1" as CompanyId, userId: "u1" as UserId, generation: 1 };
const now = new Date(7);
const link = (id = "l1"): WhatsAppLink => ({ id: id as LinkId, companyId: "c1" as CompanyId, linkedByUserId: "u1" as UserId, accountId: null, startedAt: now, endedAt: null });

function setup(options: { active?: WhatsAppLink | null } = {}) {
  const calls: string[] = [];
  const links = {
    active: async () => ok(options.active ?? null),
    start: async (companyId: CompanyId, userId: UserId) => { calls.push(`start:${companyId}:${userId}`); return ok(link("new")); },
    end: async (id: LinkId, at: Date) => { calls.push(`end:${id}:${at.getTime()}`); return ok(undefined); },
  } as unknown as LinkStore;
  return { links, calls };
}

test("starts a link for the session company and user and connects", async () => {
  const { links, calls } = setup();
  const startReception = jest.fn(async () => { calls.push("reception"); return ok({ stop: () => undefined }); });
  const result = await linkAccount({ links, session: () => session, now: () => now, startReception })();
  expect(result).toMatchObject({ success: true, data: { id: "new" } });
  expect(calls).toEqual(["start:c1:u1", "reception"]);
});

test("returns NO_SESSION without a session", async () => {
  const { links, calls } = setup();
  expect(await linkAccount({ links, session: () => null, now: () => now, startReception: jest.fn() })()).toMatchObject({ success: false, error: { code: "NO_SESSION" } });
  expect(calls).toEqual([]);
});

test("returns ALREADY_LINKED when an active link exists", async () => {
  const { links, calls } = setup({ active: link() });
  expect(await linkAccount({ links, session: () => session, now: () => now, startReception: jest.fn() })()).toMatchObject({ success: false, error: { code: "ALREADY_LINKED" } });
  expect(calls).toEqual([]);
});

test("ends the new link when initialize or connect fails so linking can be retried", async () => {
  const { links, calls } = setup();
  const startReception = async () => err({ code: "CONNECTION_FAILED" as const, message: "x" });
  expect(await linkAccount({ links, session: () => session, now: () => now, startReception })()).toMatchObject({ success: false, error: { code: "CONNECTION_FAILED" } });
  expect(calls).toEqual(["start:c1:u1", "end:new:7"]);
});

test("logs out and then ends the active link", async () => {
  const { links, calls } = setup({ active: link() });
  const whatsapp = { logout: async () => { calls.push("logout"); return ok(undefined); } };
  expect(await unlinkAccount({ links, whatsapp, now: () => now })()).toEqual({ success: true, data: { remoteLogoutConfirmed: true } });
  expect(calls).toEqual(["logout", "end:l1:7"]);
});

test("ends the link and reports REMOTE_LOGOUT_UNCONFIRMED when remote logout is not confirmed", async () => {
  const { links, calls } = setup({ active: link() });
  const whatsapp = { logout: async () => err({ code: "REMOTE_LOGOUT_UNCONFIRMED" as const, message: "x" }) };
  expect(await unlinkAccount({ links, whatsapp, now: () => now })()).toEqual({ success: true, data: { remoteLogoutConfirmed: false } });
  expect(calls).toEqual(["end:l1:7"]);
});

test("keeps the link when logout fails for another reason", async () => {
  const { links, calls } = setup({ active: link() });
  const whatsapp = { logout: async () => err({ code: "NATIVE_CALL_FAILED" as const, message: "x" }) };
  expect(await unlinkAccount({ links, whatsapp, now: () => now })()).toMatchObject({ success: false, error: { code: "NATIVE_CALL_FAILED" } });
  expect(calls).toEqual([]);
});

test("returns NOT_LINKED when there is no active link", async () => {
  const { links } = setup();
  expect(await unlinkAccount({ links, whatsapp: { logout: jest.fn() }, now: () => now })()).toMatchObject({ success: false, error: { code: "NOT_LINKED" } });
});
