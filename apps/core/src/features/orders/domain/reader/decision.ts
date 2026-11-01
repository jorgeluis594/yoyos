import { z } from "zod";
import type { PositiveInteger } from "@core/src/features/orders/domain/order";
import type { QuoteId } from "@core/src/features/orders/domain/reader/refs";
import { suggestedQuestionSchema, type SuggestedQuestion } from "@core/src/features/orders/domain/suggested-question";

export type CertaintySignals = Readonly<{
  /** 1. Every datum used has verified words. */
  quotesComplete: boolean;
  /** 2. How the target was named. */
  targetNamed: "named" | "photo_same_message" | "photo_just_sent_set" | "context";
  /** 3. */
  variantChangeVerb: "present" | "absent" | "not_applicable";
  /** 4. */
  candidates: "single" | "several";
}>;
export type ChangeRisk = "low" | "high";
export type Agreement = "agree" | "disagree" | "not_run";

/** The problems an urgent decision can name: the problem outcomes of a message. */
export const problemKinds = ["not_identified", "not_clear", "variant_missing", "variant_not_available", "quantity_above_limit", "unclear_item", "unnamed_add",
  "variant_only", "no_open_order", "order_closed", "product_not_available", "variant_for_several_pendings", "request_not_allowed", "reader_doubt", "payment_requested",
  "image_with_request", "invalid_action", "ready_with_pendings"] as const;
export type ProblemKind = (typeof problemKinds)[number];

export type OriginalDoubtReason =
  | Readonly<{ kind: "variant_changed"; attribute: string; from: string; to: string }>
  | Readonly<{ kind: "quantity_set"; quantity: PositiveInteger }>
  | Readonly<{ kind: "added_by_reference"; quantity: PositiveInteger; quote: QuoteId | null }>
  | Readonly<{ kind: "removed"; product: string }>
  /** A price the buyer mentioned on an item the message did not name: kept as a note, in the order's currency. */
  | Readonly<{ kind: "price_noted"; amount: number; units: PositiveInteger }>
  | Readonly<{ kind: "caption_unread" }>;
/** An inherited reason never nests: it carries the original, non-inherited reason of the pending's doubt. */
export type DoubtReason = OriginalDoubtReason | Readonly<{ kind: "inherited"; from: OriginalDoubtReason }>;
export type ChangeDecision =
  | Readonly<{ kind: "applied" }>
  | Readonly<{ kind: "doubtful"; reason: DoubtReason }>
  | Readonly<{ kind: "pending" }>
  | Readonly<{ kind: "urgent"; problem: ProblemKind; question: SuggestedQuestion | null }>
  | Readonly<{ kind: "silent" }>;

const text = z.string().min(1).max(200);
const quantity = z.number().int().min(1).transform((value) => value as PositiveInteger);
const quoteId = z.number().int().min(0).transform((value) => value as QuoteId);

/** Stored in pendings, change rows and traces; validated on write and on read. */
const originalDoubtReasonSchema: z.ZodType<OriginalDoubtReason> = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("variant_changed"), attribute: text, from: text, to: text }),
  z.strictObject({ kind: z.literal("quantity_set"), quantity }),
  z.strictObject({ kind: z.literal("added_by_reference"), quantity, quote: quoteId.nullable() }),
  z.strictObject({ kind: z.literal("removed"), product: text }),
  z.strictObject({ kind: z.literal("price_noted"), amount: z.number().positive(), units: quantity }),
  z.strictObject({ kind: z.literal("caption_unread") }),
]);

export const doubtReasonSchema: z.ZodType<DoubtReason> = z.union([
  originalDoubtReasonSchema,
  z.strictObject({ kind: z.literal("inherited"), from: originalDoubtReasonSchema }),
]);

export const changeDecisionSchema: z.ZodType<ChangeDecision> = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("applied") }),
  z.strictObject({ kind: z.literal("doubtful"), reason: doubtReasonSchema }),
  z.strictObject({ kind: z.literal("pending") }),
  z.strictObject({ kind: z.literal("urgent"), problem: z.enum(problemKinds), question: suggestedQuestionSchema.nullable() }),
  z.strictObject({ kind: z.literal("silent") }),
]);
