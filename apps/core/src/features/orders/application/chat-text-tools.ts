import { z } from "zod";
import { ok } from "@shared/functional";
import { currencies, type Currency, type Money } from "@shared/money";
import type { Result } from "@shared/result";
import { defineTool, type DecisionChoiceQuestion, type RegisteredTool } from "@core/src/shared/ai-tools/application/tool-registry";
import { parseMentionedPrice, type MentionedPriceArgs } from "@core/src/features/orders/domain/mentioned-price";
import type { ChangeVariantResolution, ItemTarget, ReportOutcome, ResolvedChatAction } from "@core/src/features/orders/domain/chat-order";
import type { ProductIdentification } from "@core/src/features/orders/domain/chat-message-outcome";
import type { PositiveInteger } from "@core/src/features/orders/domain/order";
import type { ProductId } from "@core/src/features/products/domain/product";
import type { ProductWithSellableVariants, TextIdentification, VariantResolution } from "@core/src/features/products/domain/text-identification";
import type { ChatContextItem, ChatToolContext, ChatToolDependencies, ToolResolveError } from "@core/src/features/orders/application/chat-tool-types";

type ChatTool = RegisteredTool<ChatToolContext, ResolvedChatAction, ToolResolveError>;
type Resolved = Promise<Result<readonly ResolvedChatAction[], ToolResolveError>>;

/** A label, `unnamed` or amount the Decision step chose is applied only at this certainty; below it nothing changes. */
export const ITEM_CHOICE_MIN_CONFIDENCE = 0.8;
/** The most lines of one text that are identified together. */
const MAX_ADD_LINES = 10;

export const mentionedPriceArgs = z.object({
  amount: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/).describe("The amount in digits, with a dot for cents: «45», «9.90»."),
  units: z.number().int().min(1).describe("How many units the amount pays for: 1 for a price per unit («a 45 soles», «45 c/u», «a 45 cada una»); "
    + "the units it covers for a price of several («las 4 por 120» is 4)."),
  // The models name the currency they read; whether it is the order's is decided against the item's catalog price, which they do not know.
  currency: z.enum(["not_named", ...currencies, "other"]).describe("The currency the buyer names, as its code (soles PEN, dólares USD, reais BRL); "
    + "not_named when the buyer names none; other for any other currency."),
}).describe("Only a price the buyer writes in this message, never a unit price of the open order.");
type StatedPrice = z.output<typeof mentionedPriceArgs>;

/** A price is in the order's currency when the buyer names no currency or names the item's own; any other is marked to be dropped. */
export function toMentionedPriceArgs(price: StatedPrice, currency: Currency): MentionedPriceArgs {
  const inOrderCurrency = price.currency === "not_named" || price.currency === currency;
  return { amount: price.amount, units: price.units, currency: inOrderCurrency ? "order_currency" : "other" };
}

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
// Asked only with a single item, whose choice no longer says whether the message named it; it only sets `namedItem`, so it is not gated.
const referenceChoice = choiceOf(z.enum(["named", "unnamed"]));
type ReferenceChoice = z.output<typeof referenceChoice>;
const isSingleItem = (context: ChatToolContext) => context.items.length === 1;

/** The item tool's argument schema, plus the reference answer when the order has a single item. */
function withReference<Shape extends z.ZodRawShape>(context: ChatToolContext, shape: Shape) {
  const full = z.object({ ...shape, reference: referenceChoice.optional() });
  return isSingleItem(context) ? full : z.object(shape) as unknown as typeof full;
}

const variantLabel = (item: ChatContextItem) => `${item.productName}${Object.values(item.variantAttributes).map((value) => ` ${value}`).join("")}`;

/**
 * Each item tool asks its own question, so a message about two items («súmame una mochila y saca el short») is read per action. With a
 * single item a reference without a name means that item (docs/message-to-order.md), so `unnamed` is not offered: both choices fit
 * a reference without a name and the split confidence fell under ITEM_CHOICE_MIN_CONFIDENCE.
 */
function itemQuestion(context: ChatToolContext, instructions: string): DecisionChoiceQuestion {
  const [only, ...others] = context.items;
  if (only && others.length === 0) {
    return {
      name: "item",
      instructions,
      choices: [
        { value: only.label, description: `${variantLabel(only)}, the only item of the open order, also when the message does not name it (eso, elimínalo, déjalo en cuatro)` },
        { value: "not_in_order", description: "The message names a product the open order does not contain" },
      ],
    };
  }
  return {
    name: "item",
    instructions,
    choices: [
      ...context.items.map((item) => ({ value: item.label, description: variantLabel(item) })),
      { value: "unnamed", description: "The message refers to an item without saying which (eso, elimínalo, déjalo en dos)" },
      { value: "not_in_order", description: "The message names a product the open order does not contain" },
      { value: "ambiguous", description: "More than one item of the order fits what the message names" },
    ],
  };
}

const referenceQuestion: DecisionChoiceQuestion = {
  name: "reference",
  instructions: "Does the message name the item it refers to?",
  choices: [
    { value: "named", description: "It names the item by its product, size or color" },
    { value: "unnamed", description: "It refers to the item without naming it (eso, elimínalo, déjalo en cuatro)" },
  ],
};

/** The item question of an item tool and, with a single item, whether the message named it. */
const itemQuestions = (context: ChatToolContext, instructions: string): readonly DecisionChoiceQuestion[] =>
  [itemQuestion(context, instructions), ...(isSingleItem(context) ? [referenceQuestion] : [])];

const amountQuestion: DecisionChoiceQuestion = {
  name: "amount",
  instructions: "Does the buyer remove the whole item or only one unit of it?",
  choices: [
    { value: "all", description: "Remove the item, whatever its quantity (saca la mochila, elimínalo, ya no va)" },
    { value: "one", description: "Remove a single unit and keep the rest (réstale uno, deja dos de las tres casacas)" },
  ],
};

/**
 * Whether the buyer explicitly asks to change the item, or only names a variant. Founder rule (docs/message-to-order.md «Change variant»):
 * only an explicit request changes an item, at ITEM_CHOICE_MIN_CONFIDENCE; anything else reports `variant_only` and changes nothing.
 */
export const changeRequestChoice = choiceOf(z.enum(["requested", "only_named"]));
const changeRequestQuestion: DecisionChoiceQuestion = {
  name: "change",
  instructions: "Does the buyer explicitly ask to change the item to another variant, or only name a variant?",
  choices: [
    { value: "requested", description: "The buyer explicitly asks to change the item: a verb of change, or «mejor» putting the new variant in place of the item's current one" },
    { value: "only_named", description: "The buyer only gives a size or color, or says they want, need or prefer it («la prefiero en XS»), without asking to change the item" },
  ],
};

const unclear = (namedItem: boolean, namedProductId: ProductId | null): ItemTarget => ({ kind: "unclear", namedItem, namedProductId });

/** What the Decision step's item choice refers to, or why nothing can be changed. Never a model call of its own. */
async function itemTargetOf(choice: ItemChoice, context: ChatToolContext, deps: ChatToolDependencies, reference?: ReferenceChoice): Promise<Result<ItemTarget, ToolResolveError>> {
  // A reference that names nothing stays unnamed however unsure the choice is.
  if (choice.confidence < ITEM_CHOICE_MIN_CONFIDENCE || choice.value === "ambiguous") return ok(unclear(choice.value !== "unnamed", null));
  if (choice.value === "unnamed") return ok({ kind: "unnamed" });
  if (choice.value === "not_in_order") {
    if (!context.caption) return ok(unclear(true, null));
    const top = await deps.findTopTextCandidate(context.caption);
    return top.success ? ok(unclear(true, top.data?.productId ?? null)) : top;
  }
  const item = context.items.find(({ label }) => label === choice.value);
  if (!item) return ok(unclear(true, null));
  // The only item referred to without a name is the unnamed reference the order domain records as not named.
  return ok(isSingleItem(context) && reference?.value === "unnamed" ? { kind: "unnamed" } : { kind: "variant", variantId: item.variantId });
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
export const priceOf = (args: StatedPrice | null, currency: Money["currency"] | null) => (args && currency ? parseMentionedPrice(toMentionedPriceArgs(args, currency), currency) : null);

// add_products
const addLine = z.object({
  productMention: z.string().max(120).describe("The product words only, without size, color, quantity or price: «chaleco acolchado celeste XS x3» is «chaleco acolchado»."),
  variantWords: z.array(z.string().max(60)).max(5).describe("The size and color words as written, with any «talla» or «color» before them, never product words: «short deportivo celeste talla 38» gives «celeste», «talla 38»."),
  quantity: z.number().int().min(1).nullable().describe("The units the buyer asks for, in digits, number words or quantity idioms (a pair is 2, half a dozen 6, a dozen 12, «x3» 3). "
    + "Only the units of this line: «3 mochilas, dos celestes y una gris» is two lines, of 2 and 1. Null when not stated."),
  mentionedPrice: mentionedPriceArgs.nullable(),
});
const addProductsArgs = z.object({ lines: z.array(addLine).min(1).max(MAX_ADD_LINES) });

type PriceHint = Readonly<{ priceHint: number | null; priceHintCurrency: Currency | null }>;
const noHint: PriceHint = { priceHint: null, priceHintCurrency: null };

/**
 * The unit amount the buyer stated, for products to compare with the candidates' prices. A named currency travels with it, so «35 soles»
 * in a chat without an order still tells products apart; a currency other than the open order's, or one the models cannot name, gives none.
 */
export function priceHintOf(price: StatedPrice | null, orderCurrency: Currency | null): PriceHint {
  if (!price || price.currency === "other" || price.units > 99) return noHint;
  if (price.currency !== "not_named" && orderCurrency !== null && price.currency !== orderCurrency) return noHint;
  const amount = Number(price.amount);
  if (!(amount > 0)) return noHint;
  return { priceHint: Math.round((amount / price.units) * 100) / 100, priceHintCurrency: price.currency === "not_named" ? null : price.currency };
}

async function addProducts(args: z.output<typeof addProductsArgs>, context: ChatToolContext, deps: ChatToolDependencies, signal: AbortSignal): Resolved {
  const orderCurrency = currencyOf(context, null);
  const identified = await deps.identifyProductsInText(args.lines.map((line) => ({ mention: line.productMention, ...priceHintOf(line.mentionedPrice, orderCurrency) })), signal);
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
async function changeItemVariant(args: Readonly<{ item: ItemChoice; reference?: ReferenceChoice; change: z.output<typeof changeRequestChoice>; variantWords: readonly string[]; mentionedPrice: StatedPrice | null }>,
  context: ChatToolContext, deps: ChatToolDependencies, signal: AbortSignal): Resolved {
  const target = await itemTargetOf(args.item, context, deps, args.reference);
  if (!target.success) return target;
  const item = contextItemOf(target.data, context);
  if (!item) return ok(cannotApply(target.data));
  // Without its product the variants to change to cannot be loaded or named in a report.
  if (!item.productId) return ok(cannotApply(unclear(true, null)));
  const loaded = await deps.loadSellableVariants([item.productId]);
  if (!loaded.success) return loaded;
  const product = loaded.data.find(({ productId }) => productId === item.productId);
  if (!product) return ok([{ kind: "change_variant", target: target.data, to: { kind: "not_available", productId: item.productId }, mentionedPrice: null }]);
  const resolution = await deps.resolveVariant({ product, words: args.variantWords, preselectedVariantId: item.variantId }, signal);
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
      description: "The buyer asks to add one or several products they name to the order, in one line or several («súmame una mochila celeste», «quiero 3 casacas talla XS», «me guardas el vestido»). "
        + "A message that only names a product the open order does not have, with its size, color, quantity («x3») or price («vestido floreado talla XS», «la casaca de 120 en L») also asks for it. "
        + "Give each product as the buyer wrote it (without quantity or variant), its variant words as written, the quantity only if stated, and the price only if stated.",
      args: { kind: "extracted" }, schema: () => addProductsArgs,
      resolve: (args, context, signal) => addProducts(args, context, deps, signal),
    }),
    defineTool({
      name: "remove_item",
      description: "The buyer asks to take an item out of the open order, or one unit of it: «saca la mochila», «elimínalo», «ya no quiero la casaca», «réstale uno».",
      args: { kind: "decision", questions: (context) => [...itemQuestions(context, "Which item of the open order does the buyer ask to remove?"), amountQuestion] },
      schema: (context) => withReference(context, { item: itemChoice(context), amount: amountChoice }),
      resolve: async (args, context): Resolved => {
        const target = await itemTargetOf(args.item, context, deps, args.reference);
        if (!target.success) return target;
        // With a single unit, removing the item and removing one unit are the same change, so how sure the amount is does not matter.
        const uncertain = args.amount.confidence < ITEM_CHOICE_MIN_CONFIDENCE && contextItemOf(target.data, context)?.quantity !== 1;
        return ok([{ kind: "remove", target: uncertain ? unclear(true, null) : target.data, amount: args.amount.value }]);
      },
    }),
    defineTool({
      name: "change_item_quantity",
      description: "The buyer changes how many units they want of a product already in the open order: «déjalo en cuatro», «de la casaca solo una». "
        + "Not for asking for products with a quantity («quiero 3 mochilas» adds them), not for taking an item out («saca el short» removes it), "
        + "and never for asking for more of something the buyer does not name («agrégame otros tres», «el mismo otra vez»). Give the new quantity as stated.",
      args: { kind: "extracted", questions: (context) => itemQuestions(context, "Which item of the open order does the buyer change the quantity of?") },
      schema: (context) => withReference(context, { item: itemChoice(context), quantity: z.number().int().min(0) }),
      resolve: async (args, context): Resolved => {
        const target = await itemTargetOf(args.item, context, deps, args.reference);
        return target.success ? ok([{ kind: "set_quantity", target: target.data, quantity: args.quantity }]) : target;
      },
    }),
    defineTool({
      name: "change_item_variant",
      description: "The text gives a size or color for an item already in the open order (a product the order does not have is an add, not this item): it asks to change the item to that variant "
        + "(«pásalo a talla 40», «mejor la casaca en celeste»), or only names the variant, even in one word («en XS», «la prefiero en XS», «celeste»). "
        + "Give the variant words as written and the price only if stated.",
      args: { kind: "extracted", questions: (context) => [...itemQuestions(context, "Which item of the open order does the variant refer to?"), changeRequestQuestion] },
      schema: (context) => withReference(context, { item: itemChoice(context), change: changeRequestChoice,
        variantWords: z.array(z.string().max(60)).min(1).max(5).describe("The size and color words as written, with any «talla» or «color» before them, never product words: «mejor la casaquita celeste» gives «celeste»."),
        mentionedPrice: mentionedPriceArgs.nullable() }),
      // The interpreter sends a call without an explicit change request to report_variant_without_product (variantOnlyRule).
      resolve: (args, context, signal) => changeItemVariant(args, context, deps, signal),
    }),
    defineTool({
      name: "set_item_mentioned_price",
      description: "The buyer states a price for a product already in the open order, without asking for a new product: «la casaca a 110», «el short en 40 nomás». "
        + "A price written next to a product the buyer asks for is part of adding it. Give the price as stated.",
      args: { kind: "extracted", questions: (context) => itemQuestions(context, "Which item of the open order does the stated price refer to?") },
      schema: (context) => withReference(context, { item: itemChoice(context), mentionedPrice: mentionedPriceArgs }),
      resolve: async (args, context): Resolved => {
        const target = await itemTargetOf(args.item, context, deps, args.reference);
        if (!target.success) return target;
        return ok([{ kind: "set_mentioned_price", target: target.data, price: priceOf(args.mentionedPrice, currencyOf(context, contextItemOf(target.data, context))) }]);
      },
    }),
    defineTool({
      name: "mark_order_ready",
      description: "The buyer says the order is complete or confirms it (con eso cierro, con eso termino, confírmalo, así queda). "
        + "After another request in the same message («saca el short y con eso cierro», «súmame la mochila y con eso termino») it is a second action: the message asks for several.",
      args: { kind: "none" }, schema: () => noArgs,
      resolve: async (): Resolved => ok([{ kind: "ready" }]),
    }),
    defineTool({
      name: "report_variant_without_product",
      description: "The text gives only a size or color, even in a single word, with no product name and no verb that changes an item (pásalo, déjalo en): «en XS», «la prefiero en XS», «celeste», «talla 38». "
        + "Asking for it («la prefiero») with only a size or color is this report, never a change or an add.",
      args: { kind: "none" }, reportOnly: true, schema: () => noArgs, resolve: reportOnly({ kind: "variant_only" }),
    }),
    defineTool({
      name: "report_unnamed_add",
      description: "The buyer asks for more of something without naming it (quiero más, el mismo otra vez, agrégame otros tres).",
      args: { kind: "none" }, reportOnly: true, schema: () => noArgs, resolve: reportOnly({ kind: "unnamed_add" }),
    }),
    defineTool({
      name: "report_item_change_without_order",
      description: "The buyer asks to remove or change something of their order (elimínalo, saca el short, déjalo en cuatro, pásalo a talla 40, la casaca a 90), "
        + "but the chat has no open order. Never for asking for products.",
      // Offered instead of the item tools when the order has no items; the order domain reports the missing or closed order.
      args: { kind: "none" }, reportOnly: true, schema: () => noArgs, resolve: async (): Resolved => ok(cannotApply(unclear(true, null))),
    }),
  ];
}
