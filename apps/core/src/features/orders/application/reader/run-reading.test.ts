import { describe, expect, test } from "vitest";
import { err, ok } from "@shared/functional";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { ReadingContextData } from "@core/src/features/orders/application/reader/load-reading-context";
import { hasHighRiskIntent, mentionsOf, runReading, traceStagesOf, type RunReadingDependencies } from "@core/src/features/orders/application/reader/run-reading";
import type { ReaderStages, StageCall } from "@core/src/features/orders/application/reader/stages";
import type { ExtractedRequest, IntentReading, ProductResolution, ReaderStage, Reading, RequestIntent, RequestRef } from "@core/src/features/orders/domain/reader/readings";
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

  test("drops an intent whose quote is not in the message and reads nothing more when none is left", async () => {
    const { deps, log } = fakes({ intent: { kind: "requests", requests: [intent("R1", "add", "una casaca roja")], language: "es", addresses: [] } });
    const run = await runReading(deps, context, [], signal());

    expect(run.success && run.data.primary).toMatchObject({ droppedIntents: 1, chain: null });
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

  test("a mention is a request that names its product", () => {
    const named = { request: request("R1", "add"), complete: true };
    const unnamed = { request: { ...request("R2", "add"), target: { kind: "none" } as const }, complete: true };
    expect(mentionsOf([named, unnamed]).map(({ request: id }) => id)).toEqual(["R1"]);
  });
});
