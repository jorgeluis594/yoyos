import { z } from "zod";
import { ok } from "@shared/functional";
import type { Money } from "@shared/money";
import type { Result } from "@shared/result";
import { defineTool, type DecisionChoiceQuestion, type RegisteredTool } from "@core/src/shared/ai-tools/application/tool-registry";
import { parseMentionedPrice, type MentionedPriceArgs } from "@core/src/features/orders/domain/mentioned-price";
import type { ChangeVariantResolution, ItemTarget, ReportOutcome, ResolvedChatAction } from "@core/src/features/orders/domain/chat-order";
import type { ProductIdentification } from "@core/src/features/orders/domain/chat-message-outcome";
import type { PositiveInteger } from "@core/src/features/orders/domain/order";
import type { ProductId } from "@core/src/features/products/domain/product";
import type { ProductWithSellableVariants, TextIdentification, VariantResolution } from "@core/src/features/products/domain/text-identification";
import type { ChatContextItem, ChatToolContext, ChatToolDependencies, ToolResolveError } from "@core/src/features/orders/application/chat-message-tools";

type ChatTool = RegisteredTool<ChatToolContext, ResolvedChatAction, ToolResolveError>;
type Resolved = Promise<Result<readonly ResolvedChatAction[], ToolResolveError>>;

/** A label, `unnamed` or amount the Decision step chose is applied only at this certainty; below it nothing changes. */
export const ITEM_CHOICE_MIN_CONFIDENCE = 0.8;
/** The most lines of one text that are identified together. */
const MAX_ADD_LINES = 10;

export const mentionedPriceArgs = z.object({
  amount: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/),
  units: z.number().int().min(1),
  currency: z.enum(["order_currency", "other"]),
});

const noArgs = z.object({});

/** The variant a change moves to, as the order domain names it: a failed resolution keeps the product to report. */
export function toChangeVariantResolution(resolution: VariantResolution, productId: ProductId): ChangeVariantResolution {
  switch (resolution.kind) {
    case "resolved": return { kind: "resolved", item: resolution.item };
    case "missing": return { kind: "missing", productId };
    case "not_available": return { kind: "not_available", productId };
  }
}
const report = (outcome: ReportOutcome): readonly ResolvedChatAction[] => [{ kind: "report", outcome }];
const reportOnly = (outcome: ReportOutcome) => async (): Resolved => ok(report(outcome));

// Item references: a Decision choice over the order's labels, gated by its confidence.
const itemSentinels = ["unnamed", "not_in_order", "ambiguous"] as const;
const choiceOf = <Value extends z.ZodType>(value: Value) => z.object({ value, confidence: z.number().min(0).max(1) });
const itemChoice = (context: ChatToolContext) => choiceOf(z.enum([...context.items.map(({ label }) => label), ...itemSentinels] as unknown as [string, ...string[]]));
const amountChoice = choiceOf(z.enum(["all", "one"]));
type ItemChoice = z.output<ReturnType<typeof itemChoice>>;

const variantLabel = (item: ChatContextItem) => `${item.productName}${Object.values(item.variantAttributes).map((value) => ` ${value}`).join("")}`;

function itemQuestion(context: ChatToolContext): DecisionChoiceQuestion {
  return {
    name: "item",
    instructions: "Which item of the open order does the buyer's message refer to?",
    choices: [
      ...context.items.map((item) => ({ value: item.label, description: variantLabel(item) })),
      { value: "unnamed", description: "The message refers to an item without saying which (ese, quítalo, mejor que sean 3)" },
      { value: "not_in_order", description: "The message names a product the open order does not contain" },
      { value: "ambiguous", description: "More than one item of the order fits what the message names" },
    ],
  };
}

const amountQuestion: DecisionChoiceQuestion = {
  name: "amount",
  instructions: "Does the buyer remove the whole item or only one unit of it?",
  choices: [{ value: "all", description: "Remove the item" }, { value: "one", description: "Remove only one unit of the item" }],
};

const unclear = (namedItem: boolean, namedProductId: ProductId | null): ItemTarget => ({ kind: "unclear", namedItem, namedProductId });

/** What the Decision step's item choice refers to, or why nothing can be changed. Never a model call of its own. */
async function itemTargetOf(choice: ItemChoice, context: ChatToolContext, deps: ChatToolDependencies): Promise<Result<ItemTarget, ToolResolveError>> {
  // A reference that names nothing stays unnamed however unsure the choice is.
  if (choice.confidence < ITEM_CHOICE_MIN_CONFIDENCE || choice.value === "ambiguous") return ok(unclear(choice.value !== "unnamed", null));
  if (choice.value === "unnamed") return ok({ kind: "unnamed" });
  if (choice.value === "not_in_order") {
    if (!context.caption) return ok(unclear(true, null));
    const top = await deps.findTopTextCandidate(context.caption);
    return top.success ? ok(unclear(true, top.data?.productId ?? null)) : top;
  }
  const item = context.items.find(({ label }) => label === choice.value);
  return ok(item ? { kind: "variant", variantId: item.variantId } : unclear(true, null));
}

/** The order item a target names before the order is locked; an unnamed reference names it only for a single-item order. */
function contextItemOf(target: ItemTarget, context: ChatToolContext): ChatContextItem | null {
  if (target.kind === "variant") return context.items.find(({ variantId }) => variantId === target.variantId) ?? null;
  if (target.kind === "unnamed") return context.items.length === 1 ? context.items[0]! : null;
  return null;
}

/** Lets the order domain report why an item action cannot apply (no order, closed order, unclear item) without changing anything. */
const cannotApply = (target: ItemTarget): readonly ResolvedChatAction[] => [{ kind: "set_mentioned_price", target, price: null }];

const currencyOf = (context: ChatToolContext, item: ChatContextItem | null) => (item ?? context.items[0])?.unitPrice.currency ?? null;
const priceOf = (args: MentionedPriceArgs | null, currency: Money["currency"] | null) => (args && currency ? parseMentionedPrice(args, currency) : null);

// add_products
const addLine = z.object({
  productMention: z.string().max(120),
  variantWords: z.array(z.string().max(60)).max(5),
  quantity: z.number().int().min(1).nullable(),
  mentionedPrice: mentionedPriceArgs.nullable(),
});
const addProductsArgs = z.object({ lines: z.array(addLine).min(1).max(MAX_ADD_LINES) });

/** The unit amount the buyer stated, with no currency: products compares it with each candidate's price in that candidate's own currency, so it needs no open order. */
function priceHintOf(line: z.output<typeof addLine>): number | null {
  const price = line.mentionedPrice;
  if (!price || price.currency !== "order_currency" || price.units > 99) return null;
  const amount = Number(price.amount);
  return amount > 0 ? Math.round((amount / price.units) * 100) / 100 : null;
}

async function addProducts(args: z.output<typeof addProductsArgs>, deps: ChatToolDependencies, signal: AbortSignal): Resolved {
  const identified = await deps.identifyProductsInText(args.lines.map((line) => ({ mention: line.productMention, priceHint: priceHintOf(line) })), signal);
  if (!identified.success) return identified;
  const foundIds = [...new Set(identified.data.flatMap((entry) => entry.kind === "found" ? [entry.productId] : []))];
  const loaded = foundIds.length ? await deps.loadSellableVariants(foundIds) : ok<readonly ProductWithSellableVariants[]>([]);
  if (!loaded.success) return loaded;
  const products = new Map(loaded.data.map((product) => [product.productId, product]));
  const lines = await Promise.all(args.lines.map((line, index) => addLineActions(line, identified.data[index], products, deps, signal)));
  const failed = lines.find((entry) => !entry.success);
  if (failed && !failed.success) return failed;
  return ok(lines.flatMap((entry) => entry.success ? entry.data : []));
}

async function addLineActions(line: z.output<typeof addLine>, identification: TextIdentification | undefined, products: ReadonlyMap<ProductId, ProductWithSellableVariants>,
  deps: ChatToolDependencies, signal: AbortSignal): Resolved {
  if (identification?.kind === "not_clear") return ok(report({ kind: "not_clear", productIds: identification.candidates.map(({ productId }) => productId), silent: false }));
  const product = identification?.kind === "found" ? products.get(identification.productId) : undefined;
  // A product that left the catalog since it was matched is a miss, like one nobody matched.
  if (identification?.kind !== "found" || !product) return ok(report({ kind: "not_identified", source: "text", identification: null, silent: false }));
  const shown: ProductIdentification = { method: "text", productId: product.productId, confidence: identification.confidence };
  const resolution = await deps.resolveVariant({ product, words: line.variantWords, preselectedVariantId: null }, signal);
  if (!resolution.success) return resolution;
  if (resolution.data.kind !== "resolved") {
    return ok(report({ kind: resolution.data.kind === "missing" ? "variant_missing" : "variant_not_available", productId: product.productId, identification: shown }));
  }
  const item = resolution.data.item;
  return ok([{ kind: "add", item, quantity: (line.quantity ?? 1) as PositiveInteger, mentionedPrice: priceOf(line.mentionedPrice, item.unitPrice.currency), identification: shown }]);
}

// Item tools
async function changeItemVariant(args: Readonly<{ item: ItemChoice; variantWords: readonly string[]; mentionedPrice: MentionedPriceArgs | null }>,
  context: ChatToolContext, deps: ChatToolDependencies, signal: AbortSignal): Resolved {
  const target = await itemTargetOf(args.item, context, deps);
  if (!target.success) return target;
  const item = contextItemOf(target.data, context);
  if (!item) return ok(cannotApply(target.data));
  // Without its product the variants to change to cannot be loaded or named in a report.
  if (!item.productId) return ok(cannotApply(unclear(true, null)));
  const loaded = await deps.loadSellableVariants([item.productId]);
  if (!loaded.success) return loaded;
  const product = loaded.data.find(({ productId }) => productId === item.productId);
  if (!product) return ok([{ kind: "change_variant", target: target.data, to: { kind: "not_available", productId: item.productId }, mentionedPrice: null }]);
  const resolution = await deps.resolveVariant({ product, words: args.variantWords, preselectedVariantId: null }, signal);
  if (!resolution.success) return resolution;
  const to = toChangeVariantResolution(resolution.data, item.productId);
  const mentionedPrice = to.kind === "resolved" ? priceOf(args.mentionedPrice, to.item.unitPrice.currency) : null;
  return ok([{ kind: "change_variant", target: target.data, to, mentionedPrice }]);
}

/** The text tools of the chat registry: they only read through `deps` and answer with actions. */
export function createChatTextTools(deps: ChatToolDependencies): readonly ChatTool[] {
  return [
    defineTool({
      name: "add_products",
      description: "The buyer asks to add products they name to the order. Give each product as the buyer wrote it (without quantity or variant), "
        + "its variant words as written, the quantity only if stated, and the price only if stated.",
      args: { kind: "extracted" }, schema: () => addProductsArgs,
      resolve: (args, context, signal) => addProducts(args, deps, signal),
    }),
    defineTool({
      name: "remove_item",
      description: "The buyer asks to remove an item of the order, or one unit of it.",
      args: { kind: "decision", questions: (context) => [itemQuestion(context), amountQuestion] },
      schema: (context) => z.object({ item: itemChoice(context), amount: amountChoice }),
      resolve: async (args, context): Resolved => {
        const target = await itemTargetOf(args.item, context, deps);
        if (!target.success) return target;
        const uncertain = args.amount.confidence < ITEM_CHOICE_MIN_CONFIDENCE;
        return ok([{ kind: "remove", target: uncertain ? unclear(true, null) : target.data, amount: args.amount.value }]);
      },
    }),
    defineTool({
      name: "change_item_quantity",
      description: "The buyer sets how many units of an item of the order they want. Give the quantity as stated, 0 when they no longer want it. Never for asking for more of something the buyer does not name («dame 2 de ese», «otro igual»).",
      args: { kind: "extracted", questions: (context) => [itemQuestion(context)] },
      schema: (context) => z.object({ item: itemChoice(context), quantity: z.number().int().min(0) }),
      resolve: async (args, context): Resolved => {
        const target = await itemTargetOf(args.item, context, deps);
        return target.success ? ok([{ kind: "set_quantity", target: target.data, quantity: args.quantity }]) : target;
      },
    }),
    defineTool({
      name: "change_item_variant",
      description: "The buyer explicitly asks to change an item of the order to another variant (size, color), such as «cámbialo a talla L». Never for a text that only names a variant («en talla L», «la quiero en M»). Give the variant words as written and the price only if stated.",
      args: { kind: "extracted", questions: (context) => [itemQuestion(context)] },
      schema: (context) => z.object({ item: itemChoice(context), variantWords: z.array(z.string().max(60)).min(1).max(5), mentionedPrice: mentionedPriceArgs.nullable() }),
      resolve: (args, context, signal) => changeItemVariant(args, context, deps, signal),
    }),
    defineTool({
      name: "set_item_mentioned_price",
      description: "The buyer states a price for an item already in the order. Give the price as stated.",
      args: { kind: "extracted", questions: (context) => [itemQuestion(context)] },
      schema: (context) => z.object({ item: itemChoice(context), mentionedPrice: mentionedPriceArgs }),
      resolve: async (args, context): Resolved => {
        const target = await itemTargetOf(args.item, context, deps);
        if (!target.success) return target;
        return ok([{ kind: "set_mentioned_price", target: target.data, price: priceOf(args.mentionedPrice, currencyOf(context, contextItemOf(target.data, context))) }]);
      },
    }),
    defineTool({
      name: "mark_order_ready",
      description: "The buyer says the order is complete (listo, eso es todo).",
      args: { kind: "none" }, schema: () => noArgs,
      resolve: async (): Resolved => ok([{ kind: "ready" }]),
    }),
    defineTool({
      name: "report_variant_without_product",
      description: "The text only names a variant (en talla L, negro), with no product and no verb that changes an item.",
      args: { kind: "none" }, schema: () => noArgs, resolve: reportOnly({ kind: "variant_only" }),
    }),
    defineTool({
      name: "report_unnamed_add",
      description: "The buyer asks for more of something without naming it (quiero más, otro igual, dame 2 de ese).",
      args: { kind: "none" }, schema: () => noArgs, resolve: reportOnly({ kind: "unnamed_add" }),
    }),
  ];
}
