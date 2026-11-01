import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { log } from "@core/src/shared/infrastructure/logger";
import type { MentionCandidates } from "@core/src/features/products/application/find-mention-candidates";
import type { ProductId } from "@core/src/features/products/domain/product";
import type { ProductForReading } from "@core/src/features/products/domain/reading-product";
import type { ReadingContextData } from "@core/src/features/orders/application/reader/load-reading-context";
import type { ReaderStages, StageError, StageResult } from "@core/src/features/orders/application/reader/stages";
import { maxReaderActions } from "@core/src/features/orders/domain/chat-reading";
import { assembleCandidates, productsOfTarget, type MentionSearch } from "@core/src/features/orders/domain/reader/candidates";
import { maskStageOutput, type StoredStageOutput } from "@core/src/features/orders/domain/reader/masking";
import { droppedFields, verifyIntentQuotes, verifyQuotes, type QuoteDrop, type VerifiedRequest } from "@core/src/features/orders/domain/reader/quotes";
import type { AddressSpan, ExtractedRequest, IntentReading, ProductMention, ProductResolution, ReaderStage, Reading, ReadingInput, RequestIntent, RequestRef, StageCall } from "@core/src/features/orders/domain/reader/readings";
import type { StageInputSummary, TraceStage } from "@core/src/features/orders/domain/reader/trace";

type PersistenceError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }> | Readonly<{ code: "INVALID_STORED_DATA"; message: string }>;
/** A failed reading keeps what it did so far, for the trace of a message whose reading failed: its stage records and the intent when that stage succeeded. */
export type RunReadingError = (StageError | PersistenceError) & Readonly<{ records: readonly StageRecord[]; intent: IntentReading | null }>;

/** What the reading needs besides the stages: the catalog reads the resolution stage depends on. */
export type RunReadingDependencies = Readonly<{
  stages: ReaderStages;
  /** One statement for every mention of the message; a timeout is a result, not an error. */
  findMentionCandidates: (mentions: readonly string[]) => Promise<Result<MentionCandidates, PersistenceError>>;
  findProductsForReading: (ids: readonly ProductId[]) => Promise<Result<readonly ProductForReading[], PersistenceError>>;
  candidatesPerMention: number;
  /** A signal that also aborts with `extra` and keeps the reading's budget and log ids (`withAbort`). */
  withAbort: (reading: AbortSignal, extra: AbortSignal) => AbortSignal;
}>;

/** One chain's answer: the requests with their verified quotes and what the resolution chose for each mention. */
export type ChainResult = Readonly<{ requests: readonly VerifiedRequest[]; resolutions: readonly ProductResolution[] }>;

export type StageRecord = Readonly<{ call: StageCall | null; stage: ReaderStage; input: StageInputSummary; output: StoredStageOutput | null; errorCode: string | null }>;

export type ReadingCatalog = Readonly<{
  products: readonly ProductForReading[];
  searchMs: number | null;
  matchCount: number | null;
  timedOut: boolean;
}>;

export type PrimaryReading = Readonly<{
  intent: IntentReading;
  /** The intents whose quote was found; the others were dropped. */
  intents: readonly RequestIntent[];
  /** The first request beyond `maxReaderActions`, which is cut: the message then reports `too_many_actions`. */
  overflow: RequestRef | null;
  droppedIntents: number;
  /** What the quote verification took, for `reader_quote_dropped`: dropped intents and dropped data of the primary extraction. */
  quoteDrops: readonly QuoteDrop[];
  chain: ChainResult | null;
  catalog: ReadingCatalog;
}>;

export type ConfirmingChain = Readonly<{
  /** Resolves with the confirming chain, or null when it failed (its high-risk actions then stay doubtful). */
  result: Promise<ChainResult | null>;
  /** Aborts the chain once no action needs it; whatever it already spent stays in `records`. */
  abort: () => void;
}>;

export type StartedReading = Readonly<{
  primary: PrimaryReading;
  confirming: ConfirmingChain | null;
  /** Every stage call so far, in finishing order; the confirming chain keeps adding while it runs. */
  records: StageRecord[];
}>;

const highRiskKinds: ReadonlySet<RequestIntent["kind"]> = new Set(["remove", "change_quantity", "change_variant"]);

/**
 * A high-risk intent: a removal, or a quantity or variant change. An add that names no product cannot be told from the intent alone (its target is
 * known only after extraction); such an add is high risk in the checks and, with no confirming reading, stays doubtful.
 */
export const hasHighRiskIntent = (intents: readonly RequestIntent[]) => intents.some(({ kind }) => highRiskKinds.has(kind));

function inputSummary(input: ReadingInput, extra: Partial<StageInputSummary> = {}): StageInputSummary {
  return { refs: [...input.context.map(({ ref }) => ref), ...input.items.map(({ ref }) => ref), ...input.pendings.map(({ ref }) => ref)],
    productIds: [], productNames: [], candidateIds: [], ...extra };
}

/**
 * The mentions of a message: every request that names a product by words, and every other request that carries values for a product its target
 * fixes (a pending, an item, a photo): those get the product as their one candidate, so the buyer's values are mapped to the catalog on every path.
 */
export function mentionsOf(requests: readonly VerifiedRequest[], input: ReadingInput, photoProductIds: readonly ProductId[]): readonly ProductMention[] {
  return requests.flatMap(({ request }): ProductMention[] => {
    if (request.target.kind === "named") return [{ request: request.request, words: request.target.words, values: request.values }];
    const [first] = request.values;
    const candidateIds = first ? productsOfTarget(request, input, photoProductIds) : [];
    return first && candidateIds.length > 0 ? [{ request: request.request, words: first.valueWords, values: request.values, candidateIds, valuesOnly: true }] : [];
  });
}

const sameMention = (a: ProductMention, b: ProductMention) => a.request === b.request && a.words.text.toLowerCase() === b.words.text.toLowerCase()
  && JSON.stringify(a.values.map(({ valueWords }) => valueWords.text.toLowerCase())) === JSON.stringify(b.values.map(({ valueWords }) => valueWords.text.toLowerCase()));

/** The products the checks read: loaded once, whatever the message mentions, because a photo's shown product and the order's lines are read without a mention. */
async function loadProducts(deps: RunReadingDependencies, ids: readonly ProductId[]): Promise<Result<readonly ProductForReading[], PersistenceError>> {
  const unique = [...new Set(ids)];
  return unique.length ? deps.findProductsForReading(unique) : ok([]);
}

type Searched = Readonly<{ mentions: readonly ProductMention[]; products: readonly ProductForReading[]; catalog: Omit<ReadingCatalog, "products"> }>;

/** Searches the named mentions in one statement and loads the candidate products, then gives each mention the ids it may be resolved to. A values-only mention keeps the products its target fixed. */
async function searchMentions(deps: RunReadingDependencies, mentions: readonly ProductMention[], input: ReadingInput, photoProductIds: readonly ProductId[]): Promise<Result<Searched, PersistenceError>> {
  const named = mentions.filter(({ valuesOnly }) => !valuesOnly);
  const found = named.length ? await deps.findMentionCandidates(named.map(({ words }) => words.text)) : null;
  if (found && !found.success) return found;
  const searched: MentionSearch[] = named.map(({ request }, index) => ({ request, productIds: found?.data.mentions[index]?.productIds ?? [], unavailableProductIds: found?.data.mentions[index]?.unavailableProductIds ?? [] }));
  const itemProductIds = input.items.flatMap(({ productId }) => (productId ? [productId] : []));
  const pendingProductIds = input.pendings.flatMap(({ productIds }) => productIds);
  const assembled = assembleCandidates({ searched, photoProductId: photoProductIds[0] ?? null, itemProductIds, pendingProductIds, perMention: deps.candidatesPerMention });
  const valuesOnlyIds = mentions.flatMap(({ candidateIds, valuesOnly }) => (valuesOnly ? candidateIds ?? [] : []));
  const loaded = await loadProducts(deps, [...assembled.productIds, ...photoProductIds, ...itemProductIds, ...pendingProductIds, ...valuesOnlyIds]);
  if (!loaded.success) return loaded;
  return ok({ mentions: mentions.map((mention) => (mention.valuesOnly ? mention : { ...mention, candidateIds: assembled.byMention.get(mention.request) ?? [] })), products: loaded.data,
    catalog: { searchMs: found?.data.durationMs ?? null, matchCount: found ? found.data.mentions.reduce((sum, entry) => sum + entry.matchCount, 0) : null, timedOut: found?.data.timedOut ?? false } });
}

type Recorder = (stage: ReaderStage, result: Result<StageResult<unknown>, StageError>, input: StageInputSummary, output: StoredStageOutput | null) => void;

/**
 * The staged reading of one message, up to the checks: intent, extraction and resolution, with the confirming chain started together with the
 * primary extraction when an intent is high-risk. Model calls and the mention search are outside the transaction. A stage that fails is an error
 * (a retry decided by the handler); the confirming chain never fails the message: it only leaves its actions without a second opinion.
 */
export async function runReading(deps: RunReadingDependencies, context: ReadingContextData, photoProductIds: readonly ProductId[], signal: AbortSignal,
  started: Readonly<{ intent?: Promise<Result<StageResult<IntentReading>, StageError>> }> = {}): Promise<Result<StartedReading, RunReadingError>> {
  const { stages } = deps;
  const input: ReadingInput = { ...context.input, photo: context.input.current.kind === "image" ? { productId: photoProductIds[0] ?? null } : null };
  const records: StageRecord[] = [];
  const record: Recorder = (stage, result, summary, output) => {
    const call = result.success ? result.data.call : result.error.call;
    records.push({ call, stage, input: summary, output, errorCode: result.success ? null : result.error.code });
  };

  let read: IntentReading | null = null;
  const fail = (error: StageError | PersistenceError): Result<never, RunReadingError> => err({ ...error, records, intent: read });

  const intentResult = await (started.intent ?? stages.readIntent(input, "primary", signal));
  const addresses = intentResult.success ? intentResult.data.value.addresses : [];
  record("intent", intentResult, inputSummary(input), intentResult.success ? maskStageOutput("intent", intentResult.data.value, addresses) : null);
  if (!intentResult.success) return fail(intentResult.error);
  const intent = intentResult.data.value;
  read = intent;
  const empty: ReadingCatalog = { products: [], searchMs: null, matchCount: null, timedOut: false };
  if (intent.kind !== "requests") return ok({ primary: { intent, intents: [], overflow: null, droppedIntents: 0, quoteDrops: [], chain: null, catalog: empty }, confirming: null, records });

  const overflow = intent.requests[maxReaderActions]?.id ?? null;
  const { kept: intents, dropped } = verifyIntentQuotes(intent.requests.slice(0, maxReaderActions), input);
  const intentDrops = dropped.map(({ kind }): QuoteDrop => ({ requestKind: kind, field: "intent" }));
  if (intents.length === 0) return ok({ primary: { intent, intents, overflow, droppedIntents: dropped.length, quoteDrops: intentDrops, chain: null, catalog: empty }, confirming: null, records });

  const extract = (reading: Reading, extractSignal: AbortSignal) => stages.extractRequests(input, intents, reading, extractSignal);
  const primaryExtraction = extract("primary", signal);
  const abort = new AbortController();
  const confirmSignal = deps.withAbort(signal, abort.signal);
  const wantsConfirming = hasHighRiskIntent(intents);
  // A stage without a confirming configuration reuses the primary result: the chain awaits it instead of calling the port again.
  const confirmingExtraction = wantsConfirming ? (stages.confirms.extraction ? extract("confirming", confirmSignal) : primaryExtraction) : null;

  const extracted = await primaryExtraction;
  const extractionSummary = inputSummary(input);
  record("extraction", extracted, extractionSummary, extracted.success ? maskStageOutput("extraction", extracted.data.value, addresses) : null);
  if (!extracted.success) { abort.abort(); return fail(extracted.error); }

  const requests = verifyQuotes(extracted.data.value as readonly ExtractedRequest[], input);
  const extractionDrops = requests.flatMap(({ request }, index) => droppedFields((extracted.data.value as readonly ExtractedRequest[])[index]!, request).map((field): QuoteDrop => ({ requestKind: request.kind, field })));
  const mentions = mentionsOf(requests, input, photoProductIds);
  const known = [...photoProductIds, ...input.items.flatMap(({ productId }) => (productId ? [productId] : [])), ...input.pendings.flatMap(({ productIds }) => productIds)];
  const noSearch = async (): Promise<Result<Searched, PersistenceError>> => {
    const loaded = await loadProducts(deps, known);
    return loaded.success ? ok({ mentions: [], products: loaded.data, catalog: { searchMs: null, matchCount: null, timedOut: false } }) : loaded;
  };
  const searched = mentions.length ? await searchMentions(deps, mentions, input, photoProductIds) : await noSearch();
  if (!searched.success) { abort.abort(); return fail(searched.error); }
  const resolved = searched.data.mentions.length ? await stages.chooseProducts(searched.data.mentions, searched.data.products, "primary", signal) : null;
  if (resolved) record("resolution", resolved, resolutionSummary(input, searched.data), resolved.success ? maskStageOutput("resolution", resolved.data.value, addresses) : null);
  if (resolved && !resolved.success) { abort.abort(); return fail(resolved.error); }
  const resolutions = resolved?.success ? resolved.data.value : [];
  const chain: ChainResult = { requests, resolutions };
  const primary: PrimaryReading = { intent, intents, overflow, droppedIntents: dropped.length, quoteDrops: [...intentDrops, ...extractionDrops], chain, catalog: { products: searched.data.products, ...searched.data.catalog } };

  const confirming: ConfirmingChain | null = confirmingExtraction ? {
    abort: () => abort.abort(),
    result: confirmChain(deps, stages, input, confirmingExtraction, chain, searched.data, photoProductIds, confirmSignal, addresses, record),
  } : null;
  return ok({ primary, confirming, records });
}

function resolutionSummary(input: ReadingInput, searched: Searched): StageInputSummary {
  return inputSummary(input, { productIds: searched.products.map(({ productId }) => productId), productNames: searched.products.map(({ name }) => name),
    candidateIds: searched.mentions.flatMap(({ candidateIds }) => candidateIds ?? []) });
}

/**
 * The confirming chain: its extraction (the stage's confirming configuration, or the primary result when it has none) and, for the mentions the
 * primary did not search, one more search and resolution. A mention the primary already resolved the same way reuses the primary resolution.
 */
async function confirmChain(deps: RunReadingDependencies, stages: ReaderStages, input: ReadingInput, extraction: Promise<Result<StageResult<readonly ExtractedRequest[]>, StageError>>,
  primary: ChainResult, primarySearch: Searched, photoProductIds: readonly ProductId[], signal: AbortSignal, addresses: readonly AddressSpan[], record: Recorder): Promise<ChainResult | null> {
  try {
    const extracted = await extraction;
    if (extracted.success && extracted.data.call.reading === "confirming") record("extraction", extracted, inputSummary(input), maskStageOutput("extraction", extracted.data.value, addresses));
    else if (!extracted.success) { record("extraction", extracted, inputSummary(input), null); return null; }
    const requests = verifyQuotes(extracted.data.value as readonly ExtractedRequest[], input);
    const mentions = mentionsOf(requests, input, photoProductIds);
    const fresh = mentions.filter((mention) => !primarySearch.mentions.some((known) => sameMention(known, mention)));
    const reused = primary.resolutions.filter((resolution) => mentions.some((mention) => mention.request === resolution.request && !fresh.includes(mention)));
    if (fresh.length === 0) return { requests, resolutions: reused };
    const searched = await searchMentions(deps, fresh, input, photoProductIds);
    if (!searched.success || signal.aborted) return null;
    const resolved = await stages.chooseProducts(searched.data.mentions, [...searched.data.products, ...primarySearch.products], "confirming", signal);
    record("resolution", resolved, resolutionSummary(input, searched.data), resolved.success ? maskStageOutput("resolution", resolved.data.value, addresses) : null);
    return resolved.success ? { requests, resolutions: [...reused, ...resolved.data.value] } : null;
  } catch (cause) {
    log.warn({ event: "reader_confirming_chain_failed", err: cause }, "reader_confirming_chain_failed");
    return null;
  }
}

/** The stage records of a reading as the trace stores them; a stage that never ran leaves no record. */
export const traceStagesOf = (records: readonly StageRecord[]): readonly TraceStage[] =>
  records.flatMap(({ call, input, output, errorCode }) => (call ? [{ call, input, output, errorCode }] : []));

export type { RequestRef };
