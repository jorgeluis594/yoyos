import { describe, expect, test } from "vitest";
import { err, ok } from "@shared/functional";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { ReadingContextData } from "@core/src/features/orders/application/reader/load-reading-context";
import { hasHighRiskIntent, mentionsOf, runReading, withoutQuantity, traceStagesOf, type RunReadingDependencies } from "@core/src/features/orders/application/reader/run-reading";
import type { ReaderStages, StageCall } from "@core/src/features/orders/application/reader/stages";
import type { ExtractedRequest, IntentReading, ContextMessageRef, ProductResolution, ReaderStage, Reading, RequestIntent, RequestRef } from "@core/src/features/orders/domain/reader/readings";
import { withAbort } from "@core/src/features/orders/infrastructure/reader/runtime/reading-deadline";
import type { ProductId } from "@core/src/features/products/domain/product";
import type { ProductForReading } from "@core/src/features/products/domain/reading-product";

const productId = "00000000-0000-4000-8000-000000000021" as ProductId;
const text = "dame la polera gris en M";
const current = (quote: string) => ({ source: "current" as const, text: quote });
const intent = (id: string, kind: RequestIntent["kind"], quote = "la polera gris"): RequestIntent => ({ id: id as RequestRef, kind, quote: current(quote) });
const context = { target: { kind: "none" }, life: { alive: [], ended: [] }, contextMessageIds: new Map(), masks: new Map(), photoOutcome: null, cut: { contextDropped: 0, itemsOmitted: 0, pendingsOmitted: 0 },
  input: { current: { messageId: "m1" as ChatMessageId, kind: "text", text }, context: [], items: [], pendings: [], photoMemory: null, photo: null } } as unknown as ReadingContextData;
const call = (stage: ReaderStage, reading: Reading): StageCall => ({ stage, reading, provider: "fake", model: "m", promptVersion: "v1", usage: null, costUsd: null, durationMs: 1, attempts: 1 });
const request = (id: string, kind: ExtractedRequest["kind"]): ExtractedRequest => ({ request: id as RequestRef, kind, target: { kind: "named", words: current("la polera gris") }, values: [], quantity: null, price: null, changeVerb: null });
const chosen = (id: string): ProductResolution => ({ request: id as RequestRef, kind: "chosen", productId, values: [] });
const product = { productId, name: "Polera gris", sellable: true, attributes: [], variants: [] } as unknown as ProductForReading;

type Log = { calls: string[]; signals: AbortSignal[]; searches: number };
function fakes(over: { intent?: IntentReading; confirms?: boolean; extraction?: ExtractedRequest[] } = {}) {
  const log: Log = { calls: [], signals: [], searches: 0 };
  const intents = over.intent ?? { kind: "requests", requests: [intent("R1", "change_quantity")], language: "es", addresses: [] };
  const stages: ReaderStages = {
    readIntent: async (_input, reading) => { log.calls.push(`intent:${reading}`); return ok({ value: intents, call: call("intent", reading) }); },
    extractRequests: async (_input, _intents, reading, signal) => { log.calls.push(`extraction:${reading}`); log.signals.push(signal); return ok({ value: over.extraction ?? [request("R1", "change_quantity")], call: call("extraction", reading) }); },
    chooseProducts: async (_mentions, _candidates, reading) => { log.calls.push(`resolution:${reading}`); return ok({ value: [chosen("R1")], call: call("resolution", reading) }); },
    confirms: { intent: false, extraction: over.confirms ?? true, resolution: false },
  };
  const deps: RunReadingDependencies = { stages, candidatesPerMention: 5, withAbort,
    findMentionCandidates: async (mentions) => { log.searches += 1; return ok({ mentions: mentions.map(() => ({ productIds: [productId], unavailableProductIds: [], matchCount: 1, wordsSearched: 2 })), durationMs: 5, timedOut: false }); },
    findProductsForReading: async () => ok([product]) };
  return { deps, log };
}
const signal = () => new AbortController().signal;

describe("runReading", () => {
  test("skips extraction and resolution when the intent is no intent", async () => {
    const { deps, log } = fakes({ intent: { kind: "no_intent", reason: "greeting", language: "es", addresses: [] } });
    const run = await runReading(deps, context, [], signal());

    expect(run.success && run.data.primary.chain).toBeNull();
    expect(log.calls).toEqual(["intent:primary"]);
  });

  test("starts the confirming extraction with the primary one for a high-risk intent and returns both chains", async () => {
    const { deps, log } = fakes();
    const run = await runReading(deps, context, [], signal());

    expect(run.success).toBe(true);
    if (!run.success) return;
    expect(log.calls.slice(0, 3)).toEqual(["intent:primary", "extraction:primary", "extraction:confirming"]);
    const confirmed = await run.data.confirming!.result;
    expect(confirmed?.resolutions.map(({ request }) => request)).toEqual(["R1"]);
    expect(log.searches).toBe(1);
    expect(traceStagesOf(run.data.records).map(({ call }) => `${call.stage}:${call.reading}`)).toEqual(["intent:primary", "extraction:primary", "resolution:primary", "extraction:confirming"]);
  });

  test("reuses the primary extraction instead of calling the port when the stage has no confirming configuration", async () => {
    const { deps, log } = fakes({ confirms: false });
    const run = await runReading(deps, context, [], signal());

    if (!run.success) throw new Error("expected a reading");
    const confirmed = await run.data.confirming!.result;
    expect(log.calls.filter((entry) => entry.startsWith("extraction"))).toEqual(["extraction:primary"]);
    expect(confirmed?.requests).toEqual(run.data.primary.chain?.requests);
    expect(confirmed?.resolutions).toEqual(run.data.primary.chain?.resolutions);
    expect(log.searches).toBe(1);
  });

  test("starts no confirming chain for an add", async () => {
    const { deps } = fakes({ intent: { kind: "requests", requests: [intent("R1", "add")], language: "es", addresses: [] }, extraction: [request("R1", "add")] });
    const run = await runReading(deps, context, [], signal());

    expect(run.success && run.data.confirming).toBeNull();
  });

  test("starts the confirming chain for an add or a completion when the chat has pendings, and for neither without them", async () => {
    const pendings = [{ ref: "Q1", pendingId: "p1", productIds: [productId], known: {}, quantity: 1, doubtful: false }];
    const withPending = { ...context, input: { ...context.input, pendings } } as unknown as ReadingContextData;
    const values = [{ attributeWords: null, valueWords: current("negra") }];
    const cases = [{ kind: "complete_pending" as const, extraction: { ...request("R1", "complete_pending"), target: { kind: "pending" as const, ref: "Q1" as never, named: null }, values } },
      { kind: "add" as const, extraction: request("R1", "add") }];
    for (const { kind, extraction } of cases) {
      const intents = { kind: "requests" as const, requests: [intent("R1", kind)], language: "es" as const, addresses: [] };
      const withPendings = fakes({ intent: intents, extraction: [extraction] });
      const withRun = await runReading(withPendings.deps, withPending, [], signal());
      expect(withRun.success && withRun.data.confirming).not.toBeNull();
      expect(withPendings.log.calls).toContain("extraction:confirming");

      const without = fakes({ intent: intents, extraction: [extraction] });
      const withoutRun = await runReading(without.deps, context, [], signal());
      expect(withoutRun.success && withoutRun.data.confirming === null).toBe(true);
      expect(without.log.calls.includes("extraction:confirming")).toBe(false);
    }
  });

  test("aborts the confirming chain's signal while keeping the reading's deadline, and never the primary's", async () => {
    const { deps, log } = fakes();
    const run = await runReading(deps, context, [], signal());

    if (!run.success) throw new Error("expected a reading");
    run.data.confirming!.abort();
    const [primary, confirming] = log.signals;
    expect(confirming!.aborted).toBe(true);
    expect(primary!.aborted).toBe(false);
  });

  test("searches every mention of the message in one statement", async () => {
    const { deps, log } = fakes({ intent: { kind: "requests", requests: [intent("R1", "add"), intent("R2", "add", "la polera gris")], language: "es", addresses: [] }, extraction: [request("R1", "add"), request("R2", "add")] });
    await runReading(deps, context, [], signal());

    expect(log.searches).toBe(1);
  });

  test("keeps the refs of the dropped intents when other intents survive", async () => {
    const { deps } = fakes({ intent: { kind: "requests", requests: [intent("R1", "add"), intent("R2", "add", "una casaca roja")], language: "es", addresses: [] }, extraction: [request("R1", "add")] });
    const run = await runReading(deps, context, [], signal());

    expect(run.success && run.data.primary).toMatchObject({ droppedIntents: 1, droppedRequests: ["R2"] });
  });

  test("reads one request for an extraction repeated once, keeps the other as absorbed, and keeps both when the message says the words twice", async () => {
    const once = fakes({ intent: { kind: "requests", requests: [intent("R1", "add"), intent("R2", "add")], language: "es", addresses: [] }, extraction: [request("R1", "add"), request("R2", "add")] });
    const single = await runReading(once.deps, context, [], signal());
    expect(single.success && single.data.primary.chain?.requests.map(({ request: entry }) => entry.request)).toEqual(["R1"]);
    expect(single.success && single.data.primary.chain?.absorbed).toEqual(["R2"]);

    const twice = { ...context, input: { ...context.input, current: { ...context.input.current, text: "la polera gris y la polera gris" } } } as unknown as ReadingContextData;
    const both = fakes({ intent: { kind: "requests", requests: [intent("R1", "add"), intent("R2", "add")], language: "es", addresses: [] }, extraction: [request("R1", "add"), request("R2", "add")] });
    const double = await runReading(both.deps, twice, [], signal());
    expect(double.success && double.data.primary.chain?.requests.map(({ request: entry }) => entry.request)).toEqual(["R1", "R2"]);
  });

  test("starts the confirming extraction for an add only when the order has lines", async () => {
    const add = { kind: "requests", requests: [intent("R1", "add")], language: "es", addresses: [] } as const;
    const empty = fakes({ intent: add, extraction: [request("R1", "add")] });
    const none = await runReading(empty.deps, context, [], signal());
    expect(none.success && none.data.confirming).toBeNull();

    const withLines = { ...context, input: { ...context.input, items: [{ ref: "I1", itemId: "i1", productId, variantId: "v1", productName: "Polera gris", variantAttributes: {}, quantity: 1 }] } } as unknown as ReadingContextData;
    const lines = fakes({ intent: add, extraction: [request("R1", "add")] });
    const run = await runReading(lines.deps, withLines, [], signal());
    expect(run.success && run.data.confirming).not.toBeNull();
  });

  test("drops an intent whose quote is not in the message and reads nothing more when none is left", async () => {
    const { deps, log } = fakes({ intent: { kind: "requests", requests: [intent("R1", "add", "una casaca roja")], language: "es", addresses: [] } });
    const run = await runReading(deps, context, [], signal());

    expect(run.success && run.data.primary).toMatchObject({ droppedIntents: 1, chain: null, quoteDrops: [{ requestKind: "add", field: "intent" }] });
    expect(log.calls).toEqual(["intent:primary"]);
  });

  test("fails with the stage error when the intent stage fails", async () => {
    const { deps } = fakes();
    const failing: ReaderStages = { ...deps.stages, readIntent: async () => err({ code: "AI_PROVIDER_UNAVAILABLE", stage: "intent", call: null, message: "down" }) };
    const run = await runReading({ ...deps, stages: failing }, context, [], signal());

    expect(run).toEqual({ success: false, error: expect.objectContaining({ code: "AI_PROVIDER_UNAVAILABLE", stage: "intent" }) });
  });
});

describe("helpers", () => {
  test("only a removal, a quantity change or a variant change is a high-risk intent", () => {
    expect(hasHighRiskIntent([intent("R1", "add"), intent("R2", "remove")])).toBe(true);
    expect(hasHighRiskIntent([intent("R1", "add"), intent("R2", "payment_request")])).toBe(false);
  });

  test("a mention carries the price the request states in the order's currency, with its units, and none in another currency", () => {
    const priced = (currency: "order" | "other") => ({ request: { ...request("R1", "add"), price: { amount: 45, currency, basis: "not_explicit" as const, quote: { source: "current" as const, text: "45" } },
      quantity: { value: 2, mode: "add" as const, quote: { source: "current" as const, text: "2" } } }, complete: true });
    expect(mentionsOf([priced("order")], context.input, [])[0]!.price).toEqual({ amount: 45, units: 2, basis: "not_explicit" });
    expect(mentionsOf([priced("other")], context.input, [])[0]!.price).toBeUndefined();
  });

  test("a mention is a request that names its product", () => {
    const named = { request: request("R1", "add"), complete: true };
    const unnamed = { request: { ...request("R2", "add"), target: { kind: "none" } as const }, complete: true };
    expect(mentionsOf([named, unnamed], context.input, []).map(({ request: id }) => id)).toEqual(["R1"]);
  });

  test("keeps the name when the quantity quote comes from another message", () => {
    const fromContext = { source: "context" as const, ref: "M1" as ContextMessageRef, text: "2" };
    expect(withoutQuantity(current("las 2 poleras"), fromContext)).toEqual(current("las 2 poleras"));
  });

  test("a fixed mention renders the name without the request's own quantity words", () => {
    const input = { ...context.input, items: [{ ref: "I1", itemId: "i1", productId, variantId: "v1", productName: "Polera", variantAttributes: {}, quantity: 3 }] } as unknown as typeof context.input;
    const target = { kind: "item", ref: "I1" as never, named: current("las 2 poleras") } as const;
    const extracted = { ...request("R1", "change_quantity"), target, quantity: { value: 2, mode: "decrease", quote: current("2") } } as ExtractedRequest;

    expect(mentionsOf([{ request: extracted, complete: true }], input, [])).toEqual([expect.objectContaining({ fixed: true, words: current("las poleras") })]);
    expect(withoutQuantity(current("las poleras"), current("2"))).toEqual(current("las poleras"));
    expect(withoutQuantity(current("2"), current("2"))).toEqual(current("2"));
  });

  test("a request with values for a product its target fixes is a values-only mention of that product", () => {
    const withValues = (target: ExtractedRequest["target"]) => ({ request: { ...request("R1", "complete_pending"), target, values: [{ attributeWords: null, valueWords: current("negra") }] }, complete: true });
    const input = { ...context.input, pendings: [{ ref: "Q1", pendingId: "p1", productIds: [productId], known: {}, quantity: 1, doubtful: false }],
      items: [{ ref: "I1", itemId: "i1", productId, variantId: "v1", productName: "Polera", variantAttributes: {}, quantity: 1 }] } as unknown as typeof context.input;

    expect(mentionsOf([withValues({ kind: "pending", ref: "Q1" as never, named: null })], input, [])).toEqual([expect.objectContaining({ valuesOnly: true, candidateIds: [productId] })]);
    expect(mentionsOf([withValues({ kind: "item", ref: "I1" as never, named: null })], input, [])).toEqual([expect.objectContaining({ valuesOnly: true, candidateIds: [productId] })]);
    expect(mentionsOf([withValues({ kind: "photo_same_message" })], input, [productId])).toEqual([expect.objectContaining({ valuesOnly: true, candidateIds: [productId] })]);
    expect(mentionsOf([withValues({ kind: "photo_same_message" })], input, [])).toEqual([]);
    expect(mentionsOf([withValues({ kind: "none" })], input, [productId])).toEqual([]);
  });
});

describe("values-only resolution", () => {
  test("resolves the values of a completion without searching the catalog", async () => {
    const values = [{ attributeWords: null, valueWords: current("negra") }];
    const { deps, log } = fakes({ intent: { kind: "requests", requests: [intent("R1", "complete_pending", "negra")], language: "es", addresses: [] },
      extraction: [{ ...request("R1", "complete_pending"), target: { kind: "pending", ref: "Q1" as never, named: null }, values }] });
    const withPending = { ...context, input: { ...context.input, text: "negra", current: { ...context.input.current, text: "negra" },
      pendings: [{ ref: "Q1", pendingId: "p1", productIds: [productId], known: {}, quantity: 1, doubtful: false }] } } as unknown as ReadingContextData;
    const run = await runReading(deps, withPending, [], signal());

    expect(run.success).toBe(true);
    expect(log.calls).toContain("resolution:primary");
    expect(log.searches).toBe(0);
  });
});
