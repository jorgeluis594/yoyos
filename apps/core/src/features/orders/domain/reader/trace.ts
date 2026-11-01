import { z } from "zod";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { ResolvedChatAction } from "@core/src/features/orders/domain/chat-order";
import type { Agreement, CertaintySignals, ChangeDecision, ChangeRisk } from "@core/src/features/orders/domain/reader/decision";
import type { ItemRef, ModelUsage, PendingRef, QuoteId, RequestRef, StageCall } from "@core/src/features/orders/domain/reader/readings";
import type { CompanyId } from "@core/src/features/orders/domain/order";
import { storedStageOutputSchema, type StoredStageOutput } from "@core/src/features/orders/domain/reader/masking";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";

/** References and catalog data (refs, product ids and names, candidate ids), never prompt text. */
export type StageInputSummary = Readonly<{ refs: readonly string[]; productIds: readonly ProductId[]; productNames: readonly string[]; candidateIds: readonly ProductId[] }>;
export type TracePhoto = Readonly<{ method: "qr" | "visual" | "none"; result: "matched" | "several" | "not_found" | "not_product" | "failed"; productId: ProductId | null;
  confidence: number | null; usage: ModelUsage | null; costUsd: number | null; durationMs: number }>;
/** `output` is the masked stored form of the stage answer, never the raw reading. */
export type TraceStage = Readonly<{ call: StageCall; input: StageInputSummary; output: StoredStageOutput | null; errorCode: string | null }>;
/** Masked, at most 80 characters. */
export type TraceQuote = Readonly<{ id: QuoteId; text: string }>;
export type TraceDecision = Readonly<{
  action: Readonly<{ kind: ResolvedChatAction["kind"]; request: RequestRef; item: ItemRef | null; pending: PendingRef | null; productId: ProductId | null; variantId: VariantId | null }>;
  signals: CertaintySignals; risk: ChangeRisk; agreement: Agreement; decision: ChangeDecision["kind"];
}>;
export type TraceShadow = Readonly<{ answer: "actions" | "no_intent" | "doubt" | "fixed"; actionKinds: readonly string[]; usage: ModelUsage | null; costUsd: number | null }>;
export type MessageTrace = Readonly<{
  companyId: CompanyId; messageId: ChatMessageId; messageReceivedAt: Date; expiresAt: Date;
  startedAt: Date; decidedAt: Date | null; queuedMs: number; shadowWaitMs: number | null;
  textState: "masked" | "withheld";
  /** Texts live once in `MessageMaskedText`. */
  contextMessageIds: readonly ChatMessageId[];
  photo: TracePhoto | null;
  stages: readonly TraceStage[];
  quotes: readonly TraceQuote[];
  decisions: readonly TraceDecision[];
  shadow: TraceShadow | null;
  /** Photo plus stages; the shadow apart. */
  costUsd: number | null;
}>;
export type MaskedText = Readonly<{ messageId: ChatMessageId; text: string; expiresAt: Date }>;

export const maxTraceQuoteChars = 80;

const uuid = z.uuid();
const productId = uuid.transform((value) => value as ProductId);
const variantId = uuid.transform((value) => value as VariantId);
const count = z.number().int().min(0);
const modelUsage: z.ZodType<ModelUsage> = z.strictObject({ inputTokens: count, cachedInputTokens: count, outputTokens: count, reasoningTokens: count });
const cost = z.number().min(0).nullable();
const ref = <T extends string>() => z.string().min(1).max(20).transform((value) => value as T);

const stageCall: z.ZodType<StageCall> = z.strictObject({
  stage: z.enum(["intent", "extraction", "resolution"]), reading: z.enum(["primary", "confirming"]), provider: z.enum(["openai", "fake"]),
  model: z.string().min(1), promptVersion: z.string().min(1), usage: modelUsage.nullable(), costUsd: cost, durationMs: count, attempts: z.union([z.literal(1), z.literal(2)]),
});

export const tracePhotoSchema: z.ZodType<TracePhoto> = z.strictObject({
  method: z.enum(["qr", "visual", "none"]), result: z.enum(["matched", "several", "not_found", "not_product", "failed"]), productId: productId.nullable(),
  confidence: z.number().min(0).max(1).nullable(), usage: modelUsage.nullable(), costUsd: cost, durationMs: count,
});

export const traceStagesSchema: z.ZodType<readonly TraceStage[]> = z.array(z.strictObject({
  call: stageCall,
  input: z.strictObject({ refs: z.array(z.string()), productIds: z.array(productId), productNames: z.array(z.string()), candidateIds: z.array(productId) }),
  output: storedStageOutputSchema.nullable(),
  errorCode: z.string().min(1).nullable(),
}));

export const traceQuotesSchema: z.ZodType<readonly TraceQuote[]> = z.array(z.strictObject({
  id: count.transform((value) => value as QuoteId), text: z.string().max(maxTraceQuoteChars),
}));

/** `kind` is the resolved action's kind; the set grows with the decision work, so it is checked as a non-empty name here. */
const actionKind = z.string().min(1) as unknown as z.ZodType<ResolvedChatAction["kind"]>;
export const traceDecisionsSchema: z.ZodType<readonly TraceDecision[]> = z.array(z.strictObject({
  action: z.strictObject({ kind: actionKind, request: ref<RequestRef>(), item: ref<ItemRef>().nullable(), pending: ref<PendingRef>().nullable(), productId: productId.nullable(), variantId: variantId.nullable() }),
  signals: z.strictObject({
    quotesComplete: z.boolean(), targetNamed: z.enum(["named", "photo_same_message", "photo_just_sent_set", "context"]),
    variantChangeVerb: z.enum(["present", "absent", "not_applicable"]), candidates: z.enum(["single", "several"]),
  }),
  risk: z.enum(["low", "high"]), agreement: z.enum(["agree", "disagree", "not_run"]),
  decision: z.enum(["applied", "doubtful", "pending", "urgent", "silent"]),
}));

export const traceShadowSchema: z.ZodType<TraceShadow> = z.strictObject({
  answer: z.enum(["actions", "no_intent", "doubt", "fixed"]), actionKinds: z.array(z.string().min(1)), usage: modelUsage.nullable(), costUsd: cost,
});
