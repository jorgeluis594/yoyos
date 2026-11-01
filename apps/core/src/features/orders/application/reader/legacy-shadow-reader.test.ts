import { afterEach, describe, expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import { log } from "@core/src/shared/infrastructure/logger";
import type { ChatSourceMessage } from "@core/src/features/orders/application/chat-source-message";
import { awaitShadow, createLegacyShadowReader, type LegacyShadowReaderDependencies } from "@core/src/features/orders/application/reader/legacy-shadow-reader";
import type { ReadChatMessage, ReaderReading } from "@core/src/features/orders/application/read-chat-message";
import type { ChatReadingContext } from "@core/src/features/orders/domain/chat-reading";

const usage = { inputTokens: 100, cachedInputTokens: 10, outputTokens: 20, reasoningTokens: 0 };
const message = { id: "m1", companyId: "c1", chatId: "chat1", contactId: "k1", direction: "incoming", uploadedByUserId: "u1", imageId: null, text: "la quiero en M", caption: null } as unknown as ChatSourceMessage;
const never = () => { throw new Error("must not be called"); };

function fakes(readChatMessage: ReadChatMessage, over: Partial<LegacyShadowReaderDependencies> = {}) {
  const seen: ChatReadingContext[] = [];
  const deps: LegacyShadowReaderDependencies = {
    readChatMessage: async (context, meta, signal) => { seen.push(context); return readChatMessage(context, meta, signal); },
    findChatOrderTarget: async () => ok({ kind: "none" } as never),
    findChatOrdersOpenedSince: async () => ok([]),
    findChatPendings: async () => ok({ pendings: [] } as never),
    findProductsForReading: async () => ok([]),
    findMessageCandidates: async () => ok({ productIds: [], matchCount: 0, durationMs: 1, timedOut: false }),
    costOf: () => 0.002,
    clock: () => new Date("2026-11-01T10:00:00Z"),
    limits: { pendingTtlMs: 1000, maxReaderProducts: 24, maxReaderItems: 40, maxReaderTextChars: 2000 },
    ...over,
  };
  return { deps, seen };
}
const answering = (answer: ReaderReading["answer"]): ReadChatMessage => async () => ok({ answer, usage });
const warned = () => vi.spyOn(log, "warn").mockImplementation(() => undefined);

afterEach(() => vi.restoreAllMocks());

describe("createLegacyShadowReader", () => {
  test("answers the kind of the legacy answer, its action kinds, usage and cost, reading the message text", async () => {
    const { deps, seen } = fakes(answering({ kind: "actions", actions: [{ kind: "ready" }, { kind: "ready" }] } as never));
    const shadow = await createLegacyShadowReader(deps)(message, new AbortController().signal);
    expect(shadow).toEqual({ answer: "actions", actionKinds: ["ready", "ready"], usage, costUsd: 0.002 });
    expect(seen.map(({ kind, text }) => [kind, text])).toEqual([["text", "la quiero en M"]]);
  });

  test("answers an empty list of kinds for an answer without actions", async () => {
    const { deps } = fakes(answering({ kind: "no_intent" }));
    expect(await createLegacyShadowReader(deps)(message, new AbortController().signal)).toMatchObject({ answer: "no_intent", actionKinds: [] });
  });

  test("answers null and logs reader_shadow_failed when the model fails", async () => {
    const warn = warned();
    const { deps } = fakes(async () => err({ code: "AI_PROVIDER_UNAVAILABLE", message: "down" }));
    expect(await createLegacyShadowReader(deps)(message, new AbortController().signal)).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: "reader_shadow_failed", companyId: "c1", messageId: "m1", errorCode: "AI_PROVIDER_UNAVAILABLE", durationMs: expect.any(Number) }), "reader_shadow_failed");
  });

  test("answers null and logs reader_shadow_failed when the state cannot be read", async () => {
    const warn = warned();
    const { deps } = fakes(answering({ kind: "no_intent" }), { findChatPendings: async () => err({ code: "PERSISTENCE_UNAVAILABLE", message: "db" }) });
    expect(await createLegacyShadowReader(deps)(message, new AbortController().signal)).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ errorCode: "PERSISTENCE_UNAVAILABLE" }), "reader_shadow_failed");
  });

  test("never rejects, even when a dependency throws", async () => {
    const warn = warned();
    const { deps } = fakes(() => never(), { findMessageCandidates: async () => never() });
    await expect(createLegacyShadowReader(deps)(message, new AbortController().signal)).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ errorCode: "SHADOW_THREW" }), "reader_shadow_failed");
  });

  test("does not call the model once the signal aborted, and passes the signal on", async () => {
    const warn = warned();
    const controller = new AbortController();
    controller.abort();
    const { deps, seen } = fakes(answering({ kind: "no_intent" }));
    expect(await createLegacyShadowReader(deps)(message, controller.signal)).toBeNull();
    expect(seen).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ errorCode: "DEADLINE_EXCEEDED" }), "reader_shadow_failed");

    const mid = new AbortController();
    const { deps: waiting } = fakes((_context, _meta, signal) => new Promise((resolve) => signal.addEventListener("abort", () => resolve(err({ code: "DEADLINE_EXCEEDED", message: "aborted" })))));
    const pending = createLegacyShadowReader(waiting)(message, mid.signal);
    mid.abort();
    expect(await pending).toBeNull();
  });

  test.each([
    ["a photo", { ...message, imageId: "img" }],
    ["a blank text", { ...message, text: "  " }],
    ["a text over the limit", { ...message, text: "a".repeat(2001) }],
  ])("reads nothing and logs nothing for %s", async (_title, source) => {
    const warn = warned();
    const { deps, seen } = fakes(answering({ kind: "no_intent" }));
    expect(await createLegacyShadowReader(deps)(source as ChatSourceMessage, new AbortController().signal)).toBeNull();
    expect(seen).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("awaitShadow", () => {
  const result = { answer: "actions" as const, actionKinds: [], usage: null, costUsd: null };

  test("returns the shadow when it finishes inside the bound", async () => {
    expect((await awaitShadow(Promise.resolve(result), 200)).shadow).toEqual(result);
  });

  test("stops waiting at the bound and returns null", async () => {
    const waited = await awaitShadow(new Promise(() => undefined), 30);
    expect(waited.shadow).toBeNull();
    expect(waited.waitedMs).toBeGreaterThanOrEqual(25);
    expect(waited.waitedMs).toBeLessThan(500);
  });

  test("returns null for a shadow that rejects", async () => {
    expect((await awaitShadow(Promise.reject(new Error("x")), 200)).shadow).toBeNull();
  });
});
