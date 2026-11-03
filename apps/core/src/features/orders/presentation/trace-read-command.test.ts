import { expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { CompanyId } from "@core/src/features/orders/domain/order";
import type { StoredMessageTraceRead } from "@core/src/features/orders/infrastructure/message-trace-repository";
import { hashToken, parseTraceReaders } from "@core/src/features/orders/presentation/trace-reader-token";
import { runTraceRead } from "@core/src/features/orders/presentation/trace-read-command";

const company = "11111111-1111-4111-8111-111111111111";
const message = "22222222-2222-4222-8222-222222222222";
const context = "33333333-3333-4333-8333-333333333333";
const readers = parseTraceReaders(`Ana:${hashToken("ana-token")}`);
const trace = { companyId: company as CompanyId, messageId: message as ChatMessageId, contextMessageIds: [context as ChatMessageId] };
const stored = { traces: [trace], texts: [{ messageId: message as ChatMessageId, text: "quiero 2 polos", expiresAt: new Date("2027-01-01T00:00:00Z") }],
  verdicts: [] } as unknown as StoredMessageTraceRead;

function run(token: string | null, overrides: Partial<Parameters<typeof runTraceRead>[0]> = {}) {
  const read = vi.fn(async () => ok(stored));
  const out: string[] = [];
  const errors: string[] = [];
  return { read, out, errors, result: runTraceRead({ args: ["--company", company, "--message", message], readers, token: async () => token, osUser: "node", read,
    print: (text) => out.push(text), fail: (text) => errors.push(text), ...overrides }) };
}

test("refuses a missing token before reading anything", async () => {
  const { read, out, errors, result } = run(null);
  expect(await result).toBe(1);
  expect(read).not.toHaveBeenCalled();
  expect(out).toEqual([]);
  expect(errors.join("")).toContain("token");
});

test("refuses an unknown token before reading anything", async () => {
  const { read, out, result } = run("nope");
  expect(await result).toBe(1);
  expect(read).not.toHaveBeenCalled();
  expect(out).toEqual([]);
});

test("refuses when no reader is configured", async () => {
  const { read, result } = run("ana-token", { readers: [] });
  expect(await result).toBe(1);
  expect(read).not.toHaveBeenCalled();
});

test("rejects malformed arguments before asking for the token", async () => {
  const token = vi.fn(async () => "ana-token");
  const { read, result } = run("ana-token", { args: ["--company", "x"], token });
  expect(await result).toBe(2);
  expect(token).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
});

test("reads with the token's reader name and prints the traces with expired context texts marked", async () => {
  const { read, out, result } = run("ana-token");
  expect(await result).toBe(0);
  expect(read).toHaveBeenCalledWith(company, { readerName: "Ana", osUser: "node", messageIds: [message] });
  const printed = JSON.parse(out.join(""));
  expect(printed.traces[0].text).toBe("quiero 2 polos");
  expect(printed.traces[0].contextTexts).toEqual([{ messageId: context, text: "texto vencido" }]);
});

test("prints nothing and fails when the audit or the read fails", async () => {
  const out: string[] = [];
  const errors: string[] = [];
  const code = await runTraceRead({ args: ["--company", company, "--message", message], readers, token: async () => "ana-token", osUser: "node",
    read: async () => err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "down" }), print: (text) => out.push(text), fail: (text) => errors.push(text) });
  expect(code).toBe(1);
  expect(out).toEqual([]);
});
