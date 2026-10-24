import { z } from "zod";
import { catalog, type ProductKey } from "@core/evals/fixtures/catalog";

/**
 * Eval cases are plain data validated here. `criterion` is the scope item agreed with the founder:
 * 1 interpretation (tool choice), 2 non-product photos, 3 text identification, 4 argument extraction, 5 visual identification.
 */

const productKeys = catalog.map(({ key }) => key) as [ProductKey, ...ProductKey[]];
export const productKey = z.enum(productKeys);
const attributes = z.record(z.string(), z.string());

export const passes = ["interpretation", "text", "image", "end_to_end"] as const;
export type EvalPass = (typeof passes)[number];

/** Outcome kinds of `orders/domain/chat-message-outcome.ts`. */
export const outcomeKinds = ["added", "removed", "quantity_lowered", "quantity_changed", "variant_changed", "mentioned_price_set", "ready", "only_item_kept",
  "order_closed", "no_intent", "ambiguous_intent", "variant_only", "unnamed_add", "image_with_request", "no_open_order", "not_identified", "not_clear",
  "variant_missing", "variant_not_available", "quantity_above_limit", "unclear_item", "new_order_after_closed", "failed"] as const;
export type OutcomeKind = (typeof outcomeKinds)[number];

const base = {
  id: z.string().regex(/^[a-z0-9-]+(~p\d+)?$/),
  criterion: z.number().int().min(1).max(5),
  /** What the case exercises: «trap», «greeting», «quantity», «hard-negative»… Reported as `kind:<value>`. */
  kind: z.string().min(1),
  /** Extra groups: `consistency` (run several times), `injection`, `paraphrase`. */
  tags: z.array(z.string()).default([]),
  /** Set when the docs allow more than one reading; the Claude judge also grades the case. */
  ambiguous: z.string().optional(),
  /** The base case a generated paraphrase rewrites. */
  paraphraseOf: z.string().optional(),
};

// Interpretation and end-to-end: a message against an open order.
export const orderLine = z.strictObject({ product: productKey, variant: attributes, quantity: z.number().int().min(1).max(99) });
export type OrderLine = z.output<typeof orderLine>;
const mentionedPrice = z.strictObject({ amount: z.number().positive(), units: z.number().int().min(1) });
export const finalLine = orderLine.extend({ mentionedPrice: mentionedPrice.nullable().default(null) });
export type FinalLine = z.output<typeof finalLine>;

/** A photo the interpretation pass identifies by hand (`shows`), so only the models of interpretation run; `label` is a printed QR label. */
const shownPhoto = z.strictObject({ shows: productKey, label: attributes.optional() });
const notProductPhoto = z.strictObject({ shows: z.literal("not_product") });
/** A photo file the end-to-end pass reads with the real identification cascade; relative to the photo folder (images/README.md) or to `apps/core`. */
const photoFile = z.strictObject({ file: z.string() });

export const messageInput = z.strictObject({
  text: z.string().optional(),
  photo: z.union([shownPhoto, notProductPhoto, photoFile]).optional(),
  caption: z.string().optional(),
  /** The chat's open order before the message; empty means the chat has no order. */
  order: z.array(orderLine).default([]),
}).refine((input) => (input.text === undefined) !== (input.photo === undefined), "A message is a text or a photo")
  .refine((input) => input.caption === undefined || input.photo !== undefined, "Only a photo has a caption");
export type MessageInput = z.output<typeof messageInput>;

export const messageExpectation = z.strictObject({
  /** The tools the models chose, as a set; absent leaves the tool unscored. `[]` means no tool ran (ambiguous, skipped or report only). */
  tools: z.array(z.string()).optional(),
  /** Outcome kinds, as a multiset; `[]` means the message was skipped without an outcome. */
  outcomes: z.array(z.enum(outcomeKinds)),
  /** The open order after the message; absent means unchanged. */
  order: z.array(finalLine).optional(),
});
export type MessageExpectation = z.output<typeof messageExpectation>;

const messageCase = z.strictObject({
  ...base,
  pass: z.enum(["interpretation", "end_to_end"]),
  input: messageInput,
  /** Acceptable outcomes: the case passes when the result matches any of them. */
  expected: z.array(messageExpectation).min(1),
});

// Identification passes.
export const textExpectation = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("found"), product: productKey }),
  z.strictObject({ kind: z.literal("not_clear"), products: z.array(productKey).optional() }),
  z.strictObject({ kind: z.literal("not_found") }),
]);
export type TextExpectation = z.output<typeof textExpectation>;

const textCase = z.strictObject({
  ...base,
  pass: z.literal("text"),
  /** The product words as the extraction model would pass them, and the unit price the buyer stated. */
  input: z.strictObject({ mention: z.string().min(1), priceHint: z.number().positive().nullable().default(null) }),
  expected: z.array(textExpectation).min(1),
});

export const imageExpectation = z.discriminatedUnion("kind", [
  /** `color`: the color of the variant a QR label must yield. */
  z.strictObject({ kind: z.literal("found"), product: productKey, color: z.string().optional() }),
  z.strictObject({ kind: z.literal("not_product") }),
  z.strictObject({ kind: z.literal("not_found") }),
]);
export type ImageExpectation = z.output<typeof imageExpectation>;

const imageCase = z.strictObject({
  ...base,
  pass: z.literal("image"),
  input: photoFile,
  expected: z.array(imageExpectation).min(1),
});

export const evalCase = z.discriminatedUnion("pass", [messageCase, textCase, imageCase]);
export type EvalCase = z.output<typeof evalCase>;
export type EvalCaseInput = z.input<typeof evalCase>;
export type MessageCase = Extract<EvalCase, { pass: "interpretation" | "end_to_end" }>;
export type TextCase = Extract<EvalCase, { pass: "text" }>;
export type ImageCase = Extract<EvalCase, { pass: "image" }>;

/** Validates a case table; duplicated ids fail like a schema error. */
export function parseCases(input: readonly EvalCaseInput[]): readonly EvalCase[] {
  const cases = z.array(evalCase).parse(input);
  const seen = new Set<string>();
  for (const { id } of cases) {
    if (seen.has(id)) throw new Error(`Duplicated eval case id ${id}`);
    seen.add(id);
  }
  return cases;
}

/**
 * Cases whose docs allow several answers, or marked ambiguous, are also graded by the Claude judge. The indistinguishable pair has a
 * founder rule instead (cases/identification.ts), so no judge.
 */
export const needsJudge = (testCase: EvalCase) => testCase.ambiguous !== undefined
  || (testCase.expected.length > 1 && !testCase.tags.includes("indistinguishable-pair"));
