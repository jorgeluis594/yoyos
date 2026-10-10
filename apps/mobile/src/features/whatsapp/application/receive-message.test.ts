import { err, ok } from "@shared/functional";
import { receiveMessage } from "@mobile/features/whatsapp/application/receive-message";
import type { LinkStore, MessageStore, Placement, SaveOutcome } from "@mobile/features/whatsapp/application/ports";
import type { CompanyId, LinkId, UserId, WhatsAppAccountId } from "@mobile/features/whatsapp/domain/ids";
import type { InboundMessage } from "@mobile/features/whatsapp/domain/inbound-message";
import type { WhatsAppLink } from "@mobile/features/whatsapp/domain/link";
import type { StoredMessage } from "@mobile/features/whatsapp/domain/stored-message";
import type { WhatsAppEvents } from "@mobile/modules/whatsapp/types";

const now = new Date(5000);
const link = (accountId: string | null): WhatsAppLink => ({
  id: "l1" as LinkId, companyId: "c1" as CompanyId, linkedByUserId: "u1" as UserId,
  accountId: accountId as WhatsAppAccountId | null, startedAt: new Date(0), endedAt: null,
});
const event = (overrides: Partial<WhatsAppEvents["messageReceived"]["message"]> = {}, deliveryId = "wa-delivery:v1:" + "a".repeat(32)): WhatsAppEvents["messageReceived"] => ({
  deliveryId,
  message: { id: "wa-message:v1:m1", accountId: "1@lid", chatId: "2@lid", whatsappMessageId: "W1", direction: "incoming", text: "secret text", timestamp: 1000, ...overrides },
});

function setup(options: { links?: WhatsAppLink[]; failLinks?: boolean; failSave?: boolean; failConfirm?: boolean } = {}) {
  const calls: string[] = [];
  const saved = new Map<string, StoredMessage>();
  const placements: Placement[] = [];
  const store: Pick<MessageStore, "saveOnce"> = {
    saveOnce: async (message: InboundMessage, placement: Placement, at: Date) => {
      calls.push("save");
      if (options.failSave) return err({ code: "LOCAL_STORAGE_FAILED", message: "x" });
      placements.push(placement);
      const existing = saved.get(message.id);
      if (existing) return ok<SaveOutcome>({ status: "duplicate", message: existing });
      const state = placement.kind === "orphan" ? { state: "orphaned" as const }
        : placement.initial === "pending" ? { state: "pending" as const, attempts: 0, nextAttemptAt: at } : { state: "held_unknown_date" as const };
      const stored: StoredMessage = { ...message, linkId: placement.kind === "linked" ? placement.link.id : null,
        companyId: placement.kind === "linked" ? placement.link.companyId : null, arrivalSeq: saved.size + 1, storedAt: at, sync: state };
      saved.set(message.id, stored);
      return ok<SaveOutcome>({ status: "stored", message: stored });
    },
  };
  const links = { all: async () => options.failLinks ? err({ code: "LOCAL_STORAGE_FAILED", message: "x" }) : ok(options.links ?? [link(null)]) } as unknown as LinkStore;
  const confirmed: string[] = [];
  let confirmFails = options.failConfirm ?? false;
  const whatsapp = {
    confirmMessageStored: async (id: string) => {
      calls.push("confirm");
      if (confirmFails) return err({ code: "NATIVE_CALL_FAILED" as const, message: "x" });
      confirmed.push(id);
      return ok(undefined);
    },
  };
  const wakeSync = jest.fn(() => { calls.push("wake"); });
  const receive = receiveMessage({ store: store as MessageStore, links, whatsapp, now: () => now, wakeSync });
  return { receive, calls, confirmed, saved, placements, wakeSync, recover: () => { confirmFails = false; } };
}

test("confirms the delivery only after saveOnce stores the message", async () => {
  const { receive, calls, confirmed } = setup();
  expect(await receive(event())).toEqual({ success: true, data: { status: "stored" } });
  expect(calls.indexOf("save")).toBeLessThan(calls.indexOf("confirm"));
  expect(confirmed).toEqual([event().deliveryId]);
});

test("does not confirm and returns LOCAL_STORAGE_FAILED when saveOnce fails", async () => {
  const { receive, confirmed } = setup({ failSave: true });
  expect(await receive(event())).toMatchObject({ success: false, error: { code: "LOCAL_STORAGE_FAILED" } });
  expect(confirmed).toEqual([]);
});

test("does not confirm when the links cannot be read", async () => {
  const { receive, confirmed, calls } = setup({ failLinks: true });
  expect(await receive(event())).toMatchObject({ success: false, error: { code: "LOCAL_STORAGE_FAILED" } });
  expect(confirmed).toEqual([]);
  expect(calls).not.toContain("save");
});

test("confirms a duplicate again with its new deliveryId without waking sync", async () => {
  const { receive, confirmed, wakeSync } = setup();
  await receive(event());
  wakeSync.mockClear();
  const second = "wa-delivery:v1:" + "b".repeat(32);
  expect(await receive(event({}, second))).toEqual({ success: true, data: { status: "duplicate" } });
  expect(confirmed).toEqual([event().deliveryId, second]);
  expect(wakeSync).not.toHaveBeenCalled();
});

test("stores once and confirms the redelivery after a failed confirmation", async () => {
  const { receive, saved, confirmed, recover } = setup({ failConfirm: true });
  expect(await receive(event())).toMatchObject({ success: false, error: { code: "NATIVE_CALL_FAILED" } });
  expect(saved.size).toBe(1);
  recover();
  expect(await receive(event())).toEqual({ success: true, data: { status: "duplicate" } });
  expect(saved.size).toBe(1);
  expect(confirmed).toHaveLength(1);
});

test("confirms an EMPTY_MESSAGE delivery as invalid without storing it", async () => {
  const { receive, saved, confirmed, calls } = setup();
  expect(await receive(event({ text: undefined }))).toEqual({ success: true, data: { status: "invalid" } });
  expect(saved.size).toBe(0);
  expect(confirmed).toHaveLength(1);
  expect(calls).not.toContain("save");
});

test("stores a message of an unknown account as orphaned, confirms it and does not wake sync", async () => {
  const { receive, saved, confirmed, wakeSync } = setup({ links: [link("9@lid")] });
  expect(await receive(event())).toEqual({ success: true, data: { status: "orphaned" } });
  expect([...saved.values()][0]?.sync).toEqual({ state: "orphaned" });
  expect(confirmed).toHaveLength(1);
  expect(wakeSync).not.toHaveBeenCalled();
});

test("stores a message without timestamp as held_unknown_date and does not wake sync", async () => {
  const { receive, saved, wakeSync } = setup();
  expect(await receive(event({ timestamp: undefined }))).toEqual({ success: true, data: { status: "stored" } });
  expect([...saved.values()][0]).toMatchObject({ sentAt: null, sync: { state: "held_unknown_date" } });
  expect(wakeSync).not.toHaveBeenCalled();
});

test("claims the active link with the account of the first message", async () => {
  const { receive, placements } = setup();
  await receive(event());
  expect(placements[0]).toMatchObject({ kind: "linked", claim: true });
});

test("uses the existing link without claiming when the account is already assigned", async () => {
  const { receive, placements } = setup({ links: [link("1@lid")] });
  await receive(event());
  expect(placements[0]).toMatchObject({ kind: "linked", claim: false });
});

test("wakes sync once after storing a pending message", async () => {
  const { receive, wakeSync } = setup();
  await receive(event());
  expect(wakeSync).toHaveBeenCalledTimes(1);
});

test("does not log text, image references or full LIDs", async () => {
  const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
  const { receive } = setup({ failSave: true });
  await receive(event());
  await setup().receive(event());
  spies.forEach((spy) => { expect(spy).not.toHaveBeenCalled(); spy.mockRestore(); });
});
