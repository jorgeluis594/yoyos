import { z } from "zod";
import { assertKnownProducts, committedCatalog, type EvalCatalog } from "@core/evals/fixtures/catalog";
import { sellerNoticeKinds } from "@core/src/features/orders/domain/seller-notice";
import type { ChatMessageOutcome } from "@core/src/features/orders/domain/chat-message-outcome";

/**
 * Eval cases are plain data validated here. `criterion` is the scope item agreed with the founder:
 * 1 interpretation, 2 non-product photos, 4 argument extraction, 5 visual identification. Conversations have none.
 */

/** A product key of the loaded catalog; `parseCases` checks it against the catalog the cases run on. */
export const productKey = z.string().min(1);
const attributes = z.record(z.string(), z.string());

export const passes = ["interpretation", "image", "end_to_end", "conversation"] as const;
export type EvalPass = (typeof passes)[number];

/** Outcome kinds of `orders/domain/chat-message-outcome.ts`. `ambiguous_intent` leaves with the domain union (T6, T7). */
export const outcomeKinds = ["added", "removed", "quantity_lowered", "quantity_changed", "variant_changed", "mentioned_price_set", "ready", "only_item_kept",
  "order_closed", "no_intent", "ambiguous_intent", "variant_only", "unnamed_add", "image_with_request", "no_open_order", "not_identified", "not_clear",
  "variant_missing", "variant_not_available", "quantity_above_limit", "unclear_item", "new_order_after_closed", "failed",
  "pending_created", "pending_updated", "pending_completed", "pending_split", "pending_ended", "reader_doubt", "request_not_allowed", "invalid_action",
  "product_not_available", "variant_for_several_pendings", "ready_with_pendings", "caption_not_applied"] as const;
export type OutcomeKind = (typeof outcomeKinds)[number];
/** Compile-time check: every outcome kind of the domain can be expected. */
type MissingOutcomeKinds = Exclude<ChatMessageOutcome["kind"], OutcomeKind>;
export const everyOutcomeKindIsExpectable: MissingOutcomeKinds extends never ? true : never = true;

export const noticeKind = z.enum(sellerNoticeKinds);

const caseBase = {
  id: z.string().regex(/^[a-z0-9-]+(~p\d+)?$/),
  /** What the case exercises: «trap», «greeting», «quantity», «hard-negative»… Reported as `kind:<value>`. */
  kind: z.string().min(1),
  /** Extra groups: `consistency` (run several times), `injection`, `paraphrase`. */
  tags: z.array(z.string()).default([]),
  /** The base case a generated paraphrase rewrites. */
  paraphraseOf: z.string().optional(),
};
const base = {
  ...caseBase,
  criterion: z.number().int().min(1).max(5),
  /** Set when the docs allow more than one reading; the Claude judge also grades the case. */
  ambiguous: z.string().optional(),
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

const messageContent = {
  text: z.string().optional(),
  photo: z.union([notProductPhoto, shownPhoto, photoFile]).optional(),
  caption: z.string().optional(),
};
const hasOneContent = (input: Readonly<{ text?: string; photo?: unknown; caption?: string }>) => (input.text === undefined) !== (input.photo === undefined);
const captionNeedsPhoto = (input: Readonly<{ photo?: unknown; caption?: string }>) => input.caption === undefined || input.photo !== undefined;

export const messageInput = z.strictObject({
  ...messageContent,
  /** The chat's open order before the message; empty means the chat has no order. */
  order: z.array(orderLine).default([]),
}).refine(hasOneContent, "A message is a text or a photo").refine(captionNeedsPhoto, "Only a photo has a caption");
export type MessageInput = z.output<typeof messageInput>;

/** A message of a conversation: the chat's earlier messages are the order, so there is no seeded order. */
const conversationInput = z.strictObject(messageContent).refine(hasOneContent, "A message is a text or a photo").refine(captionNeedsPhoto, "Only a photo has a caption");

const expectationFields = {
  /** Outcome kinds, as a multiset, when stated; `[]` means the message was skipped without an outcome. */
  outcomes: z.array(z.enum(outcomeKinds)).optional(),
  /** The open order after the message; absent means unchanged. */
  order: z.array(finalLine).optional(),
};

/**
 * What a message must leave: the notice kind it sends (`null` is silent) and the order. Message cases may still state outcomes only
 * (notice absent: unscored); conversation steps state the notice, as the rules sheet does (T7 relabels the message cases).
 */
export const messageExpectation = z.strictObject({ ...expectationFields, notice: noticeKind.nullable().optional() })
  .refine((expectation) => expectation.notice !== undefined || expectation.outcomes !== undefined, "An expectation states a notice or outcomes");
export type MessageExpectation = z.output<typeof messageExpectation>;

const stepExpectation = z.strictObject({ ...expectationFields, notice: noticeKind.nullable() });

const messageCase = z.strictObject({
  ...base,
  pass: z.enum(["interpretation", "end_to_end"]),
  input: messageInput,
  /** Acceptable outcomes: the case passes when the result matches any of them. */
  expected: z.array(messageExpectation).min(1),
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

// Conversation: one chat, its messages in order, with events between them.
const messageStep = z.strictObject({
  input: conversationInput,
  expected: stepExpectation,
  /** The rules sheet expects this step to repeat the notice of an earlier one for the same product («quiero 2 de esos» after a photo). */
  expectsRepeatNotice: z.literal(true).optional(),
});
export type MessageStep = z.output<typeof messageStep>;

/** Events act on the chat's latest order, through the production use cases, at the conversation's simulated time. */
export const eventStep = z.discriminatedUnion("event", [
  z.strictObject({ event: z.literal("advance_days"), days: z.number().int().min(1).max(60) }),
  z.strictObject({ event: z.literal("cancel_order") }),
  z.strictObject({ event: z.literal("report_payment") }),
  /** `partial`: the payment is half the order total, so the order is neither paid nor stock-deducted and a void reopens it. */
  z.strictObject({ event: z.literal("confirm_payment"), partial: z.literal(true).optional() }),
  z.strictObject({ event: z.literal("void_payment") }),
  z.strictObject({ event: z.literal("deactivate_product"), product: productKey }),
]);
export type EventStep = z.output<typeof eventStep>;

export const isEventStep = (step: ConversationStep): step is EventStep => "event" in step;
export const isMessageStep = (step: ConversationStep): step is MessageStep => !isEventStep(step);

export const minConversationMessages = 2;
export const maxConversationMessages = 4;

const conversationCase = z.strictObject({
  ...caseBase,
  pass: z.literal("conversation"),
  steps: z.array(z.union([messageStep, eventStep])).min(minConversationMessages)
    .refine((steps) => { const messages = steps.filter((step) => !("event" in step)).length; return messages >= minConversationMessages && messages <= maxConversationMessages; },
      `A conversation has ${minConversationMessages} to ${maxConversationMessages} messages`),
});
export type ConversationStep = MessageStep | EventStep;

export const evalCase = z.discriminatedUnion("pass", [messageCase, imageCase, conversationCase]);
export type EvalCase = z.output<typeof evalCase>;
export type EvalCaseInput = z.input<typeof evalCase>;
export type MessageCase = Extract<EvalCase, { pass: "interpretation" | "end_to_end" }>;
export type ImageCase = Extract<EvalCase, { pass: "image" }>;
export type ConversationCase = Extract<EvalCase, { pass: "conversation" }>;

/** Every catalog product a case names, to check them against the catalog it runs on. */
export function productsOf(testCase: EvalCase): readonly string[] {
  const lines = (order: readonly Readonly<{ product: string }>[] | undefined) => order?.map(({ product }) => product) ?? [];
  const shown = (photo: MessageInput["photo"]) => photo && "shows" in photo && photo.shows !== "not_product" ? [photo.shows] : [];
  if (testCase.pass === "image") return testCase.expected.flatMap((expectation) => expectation.kind === "found" ? [expectation.product] : []);
  if (testCase.pass === "conversation") {
    return testCase.steps.flatMap((step) => isEventStep(step) ? (step.event === "deactivate_product" ? [step.product] : [])
      : [...shown(step.input.photo), ...lines(step.expected.order)]);
  }
  return [...lines(testCase.input.order), ...shown(testCase.input.photo), ...testCase.expected.flatMap(({ order }) => lines(order))];
}

/** Validates a case table against a catalog; duplicated ids and products outside the catalog fail like a schema error. */
export function parseCases(input: readonly EvalCaseInput[], catalog: EvalCatalog = committedCatalog): readonly EvalCase[] {
  const cases = z.array(evalCase).parse(input);
  const seen = new Set<string>();
  for (const { id } of cases) {
    if (seen.has(id)) throw new Error(`Duplicated eval case id ${id}`);
    seen.add(id);
  }
  assertKnownProducts(catalog, cases.flatMap(productsOf));
  return cases;
}

/**
 * Cases whose docs allow several answers, or marked ambiguous, are also graded by the Claude judge. The indistinguishable pair has a
 * founder rule instead (cases/identification.ts), so no judge. Conversations are scored by their expectations alone.
 */
export const needsJudge = (testCase: EvalCase) => testCase.pass !== "conversation" && (testCase.ambiguous !== undefined
  || (testCase.expected.length > 1 && !testCase.tags.includes("indistinguishable-pair")));
