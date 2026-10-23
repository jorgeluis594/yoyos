import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { CompanyId, CoreMessageId, WhatsAppChatId } from "@mobile/features/whatsapp/domain/ids";
import type { StoredMessage } from "@mobile/features/whatsapp/domain/stored-message";
import type { MessageStore, StoreError } from "@mobile/features/whatsapp/application/ports";
import { locateNoticeMessage, noticeFirstQueryLimit, noticePageSize } from "@mobile/features/whatsapp/application/locate-notice-message";

const company = "c1" as CompanyId;
const chat = "2@lid" as WhatsAppChatId;
const core = "core-1" as CoreMessageId;
const failure: StoreError = { code: "LOCAL_STORAGE_FAILED", message: "x" };

const message = (seq: number, chatId = chat) => ({ id: `wa-message:v1:m${seq}`, arrivalSeq: seq, chatId, companyId: company }) as unknown as StoredMessage;

/** A chat with messages 1..newest, where the target is `target`. */
function fakeStore(newest: number, target: number | null, chatId = chat) {
  const calls: string[] = [];
  const find = jest.fn(async (): Promise<Result<StoredMessage | null, StoreError>> => ok(target === null ? null : message(target, chatId)));
  const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from + 1) }, (_, index) => message(to - index));
  const store = {
    findByCoreMessageId: find,
    listFromArrivalSeq: jest.fn(async (_c: CompanyId, _chat: WhatsAppChatId, from: number, limit: number) => {
      calls.push(`from:${from}:${limit}`);
      return ok(range(from, newest).slice(0, limit));
    }),
    listMessages: jest.fn(async (_c: CompanyId, _chat: WhatsAppChatId, page: { beforeArrivalSeq: number | null; limit: number }) => {
      calls.push(`before:${page.beforeArrivalSeq}:${page.limit}`);
      return ok(range(1, (page.beforeArrivalSeq ?? newest + 1) - 1).slice(0, page.limit));
    }),
  } as unknown as MessageStore;
  return { store, calls, find };
}

test("loads the messages from the notice's message to the newest in one query", async () => {
  const { store, calls } = fakeStore(100, 30);
  const result = await locateNoticeMessage(store, company, chat, core);
  expect(result.success && result.data.messages.map((m) => m.arrivalSeq)).toEqual(Array.from({ length: 71 }, (_, i) => 100 - i));
  expect(result.success && result.data.target.arrivalSeq).toBe(30);
  expect(calls).toEqual([`from:30:${noticeFirstQueryLimit}`]);
});

test("pages older messages by 500 when the target is more than 1000 messages back", async () => {
  const { store, calls } = fakeStore(2600, 100);
  const result = await locateNoticeMessage(store, company, chat, core);
  expect(result.success && result.data.messages.some((m) => m.arrivalSeq === 100)).toBe(true);
  expect(result.success && result.data.target.arrivalSeq).toBe(100);
  expect(calls).toEqual([`from:100:${noticeFirstQueryLimit}`, ...[1601, 1101, 601, 101].map((before) => `before:${before}:${noticePageSize}`)]);
});

test("reports the message as missing when the phone has no message with that core id", async () => {
  const { store } = fakeStore(10, null);
  expect(await locateNoticeMessage(store, company, chat, core)).toMatchObject({ success: false, error: { code: "MESSAGE_NOT_FOUND" } });
});

test("reports the message as missing when it belongs to another chat", async () => {
  const { store } = fakeStore(10, 3, "9@lid" as WhatsAppChatId);
  expect(await locateNoticeMessage(store, company, chat, core)).toMatchObject({ success: false, error: { code: "MESSAGE_NOT_FOUND" } });
});

test("returns the storage failure of the lookup or of a page", async () => {
  const lookup = fakeStore(10, 3);
  lookup.find.mockResolvedValueOnce(err(failure));
  expect(await locateNoticeMessage(lookup.store, company, chat, core)).toEqual(err(failure));
  const paging = fakeStore(2600, 100);
  (paging.store.listMessages as jest.Mock).mockResolvedValueOnce(err(failure));
  expect(await locateNoticeMessage(paging.store, company, chat, core)).toEqual(err(failure));
});
