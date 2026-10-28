import { ok } from "@shared/functional";
import type { Currency, Money } from "@shared/money";
import type { Result } from "@shared/result";
import { parseMentionedPrice, type MentionedPriceArgs } from "@core/src/features/orders/domain/mentioned-price";
import type { ChangeVariantResolution, ItemTarget, ReportOutcome, ResolvedChatAction } from "@core/src/features/orders/domain/chat-order";
import type { ProductIdentification } from "@core/src/features/orders/domain/chat-message-outcome";
import type { PositiveInteger } from "@core/src/features/orders/domain/order";
import type { ProductId } from "@core/src/features/products/domain/product";
import type { ProductWithSellableVariants, TextIdentification, VariantResolution } from "@core/src/features/products/domain/text-identification";
import type { ChatContextItem, ChatToolContext, ChatToolDependencies, ToolResolveError } from "@core/src/features/orders/application/chat-tool-types";

export type Resolved = Promise<Result<readonly ResolvedChatAction[], ToolResolveError>>;

/** A label, `unnamed` or amount the Decision step chose is applied only at this certainty; below it nothing changes. */
export const ITEM_CHOICE_MIN_CONFIDENCE = 0.8;
/** The most lines of one text that are identified together. */
export const MAX_ADD_LINES = 10;

/** An answer of the Decision step with its certainty. */
export type Choice<Value> = Readonly<{ value: Value; confidence: number }>;

/** A price the buyer writes in the message; the currency is the one they name, which may not be the order's. */
export type StatedPrice = Readonly<{ amount: string; units: number; currency: "not_named" | Currency | "other" }>;

/** A price is in the order's currency when the buyer names no currency or names the item's own; any other is marked to be dropped. */
export function toMentionedPriceArgs(price: StatedPrice, currency: Currency): MentionedPriceArgs {
  const inOrderCurrency = price.currency === "not_named" || price.currency === currency;
  return { amount: price.amount, units: price.units, currency: inOrderCurrency ? "order_currency" : "other" };
}

/** The variant a change moves to, as the order domain names it: a failed resolution keeps the product to report. */
export function toChangeVariantResolution(resolution: VariantResolution, productId: ProductId): ChangeVariantResolution {
  switch (resolution.kind) {
    case "resolved": return { kind: "resolved", item: resolution.item };
    case "missing": return { kind: "missing", productId };
    case "not_available": return { kind: "not_available", productId };
  }
}
export const report = (outcome: ReportOutcome): readonly ResolvedChatAction[] => [{ kind: "report", outcome }];

// Item references: a Decision choice over the order's labels, gated by its confidence.
/** The item choices that name no label: a reference without a name, a product outside the order, or several items that fit. */
export const ITEM_SENTINELS = ["unnamed", "not_in_order", "ambiguous"] as const;
/** Every value an item choice may take for a context: the order's labels and the sentinels. */
export const itemChoiceValues = (context: ChatToolContext): readonly string[] => [...context.items.map(({ label }) => label), ...ITEM_SENTINELS];

/**
 * With a single item a reference without a name means that item (docs/message-to-order.md), so the item question offers only that
 * item and `not_in_order`: both choices fit a reference without a name and the split confidence fell under ITEM_CHOICE_MIN_CONFIDENCE.
 * A second question, `reference`, then tells whether the message named it.
 */
export const asksItemReference = (context: ChatToolContext) => context.items.length === 1;

/** The values the item question offers: with a single item, it and `not_in_order`; otherwise every label and the sentinels. */
export function itemQuestionValues(context: ChatToolContext): readonly string[] {
  return asksItemReference(context) ? [context.items[0]!.label, "not_in_order"] : itemChoiceValues(context);
}

/** Which order item an item action refers to. `reference` is answered only when the order has a single item. */
export type ItemReference = Readonly<{ item: Choice<string>; reference?: Choice<"named" | "unnamed"> }>;

const unclear = (namedItem: boolean, namedProductId: ProductId | null): ItemTarget => ({ kind: "unclear", namedItem, namedProductId });

/** What the Decision step's item choice refers to, or why nothing can be changed. Never a model call of its own. */
async function itemTargetOf({ item: choice, reference }: ItemReference, context: ChatToolContext, deps: ChatToolDependencies): Promise<Result<ItemTarget, ToolResolveError>> {
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
  return ok(asksItemReference(context) && reference?.value === "unnamed" ? { kind: "unnamed" } : { kind: "variant", variantId: item.variantId });
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

// Add products
export type AddProductLine = Readonly<{ productMention: string; variantWords: readonly string[]; quantity: number | null; mentionedPrice: StatedPrice | null }>;
export type AddProductsInput = Readonly<{ lines: readonly AddProductLine[] }>;

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

/** Identifies each product the buyer names and adds the variant their words choose, or reports why a line cannot be added. */
export async function addProducts(input: AddProductsInput, context: ChatToolContext, deps: ChatToolDependencies, signal: AbortSignal): Resolved {
  const orderCurrency = currencyOf(context, null);
  const identified = await deps.identifyProductsInText(input.lines.map((line) => ({ mention: line.productMention, ...priceHintOf(line.mentionedPrice, orderCurrency) })), signal);
  if (!identified.success) return identified;
  const foundIds = [...new Set(identified.data.flatMap((entry) => entry.kind === "found" ? [entry.productId] : []))];
  const loaded = foundIds.length ? await deps.loadSellableVariants(foundIds) : ok<readonly ProductWithSellableVariants[]>([]);
  if (!loaded.success) return loaded;
  const products = new Map(loaded.data.map((product) => [product.productId, product]));
  const lines = await Promise.all(input.lines.map((line, index) => addLineActions(line, identified.data[index], products, deps, signal)));
  const failed = lines.find((entry) => !entry.success);
  if (failed && !failed.success) return failed;
  return ok(lines.flatMap((entry) => entry.success ? entry.data : []));
}

async function addLineActions(line: AddProductLine, identification: TextIdentification | undefined, products: ReadonlyMap<ProductId, ProductWithSellableVariants>,
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

// Item actions
export type RemoveItemInput = ItemReference & Readonly<{ amount: Choice<"all" | "one"> }>;

/** Removes the item or one unit of it; an unsure amount leaves the item unclear unless it has a single unit. */
export async function removeItem(input: RemoveItemInput, context: ChatToolContext, deps: ChatToolDependencies): Resolved {
  const target = await itemTargetOf(input, context, deps);
  if (!target.success) return target;
  // With a single unit, removing the item and removing one unit are the same change, so how sure the amount is does not matter.
  const uncertain = input.amount.confidence < ITEM_CHOICE_MIN_CONFIDENCE && contextItemOf(target.data, context)?.quantity !== 1;
  return ok([{ kind: "remove", target: uncertain ? unclear(true, null) : target.data, amount: input.amount.value }]);
}

export type ChangeItemQuantityInput = ItemReference & Readonly<{ quantity: number }>;

export async function changeItemQuantity(input: ChangeItemQuantityInput, context: ChatToolContext, deps: ChatToolDependencies): Resolved {
  const target = await itemTargetOf(input, context, deps);
  return target.success ? ok([{ kind: "set_quantity", target: target.data, quantity: input.quantity }]) : target;
}

/**
 * Whether the buyer explicitly asks to change the item, or only names a variant. Founder rule (docs/message-to-order.md «Change variant»):
 * only an explicit request changes an item, at ITEM_CHOICE_MIN_CONFIDENCE; anything else reports `variant_only` and changes nothing.
 */
export const CHANGE_REQUEST_VALUES = ["requested", "only_named"] as const;
export type ChangeItemVariantInput = ItemReference & Readonly<{
  change: Choice<(typeof CHANGE_REQUEST_VALUES)[number]>;
  variantWords: readonly string[];
  mentionedPrice: StatedPrice | null;
}>;

/** Whether a variant change's raw `change` answer is a confident explicit request; anything else, malformed included, is not. */
export function isChangeRequested(change: unknown): boolean {
  if (typeof change !== "object" || change === null) return false;
  const { value, confidence } = change as { value?: unknown; confidence?: unknown };
  return value === "requested" && typeof confidence === "number" && confidence >= ITEM_CHOICE_MIN_CONFIDENCE && confidence <= 1;
}

/** Moves the item to the variant the words choose; the interpreter has already turned a change that was not requested into a report. */
export async function changeItemVariant(input: ChangeItemVariantInput, context: ChatToolContext, deps: ChatToolDependencies, signal: AbortSignal): Resolved {
  const target = await itemTargetOf(input, context, deps);
  if (!target.success) return target;
  const item = contextItemOf(target.data, context);
  if (!item) return ok(cannotApply(target.data));
  // Without its product the variants to change to cannot be loaded or named in a report.
  if (!item.productId) return ok(cannotApply(unclear(true, null)));
  const loaded = await deps.loadSellableVariants([item.productId]);
  if (!loaded.success) return loaded;
  const product = loaded.data.find(({ productId }) => productId === item.productId);
  if (!product) return ok([{ kind: "change_variant", target: target.data, to: { kind: "not_available", productId: item.productId }, mentionedPrice: null }]);
  const resolution = await deps.resolveVariant({ product, words: input.variantWords, preselectedVariantId: item.variantId }, signal);
  if (!resolution.success) return resolution;
  const to = toChangeVariantResolution(resolution.data, item.productId);
  const mentionedPrice = to.kind === "resolved" ? priceOf(input.mentionedPrice, to.item.unitPrice.currency) : null;
  return ok([{ kind: "change_variant", target: target.data, to, mentionedPrice }]);
}

export type SetItemMentionedPriceInput = ItemReference & Readonly<{ mentionedPrice: StatedPrice }>;

export async function setItemMentionedPrice(input: SetItemMentionedPriceInput, context: ChatToolContext, deps: ChatToolDependencies): Resolved {
  const target = await itemTargetOf(input, context, deps);
  if (!target.success) return target;
  return ok([{ kind: "set_mentioned_price", target: target.data, price: priceOf(input.mentionedPrice, currencyOf(context, contextItemOf(target.data, context))) }]);
}

export const markOrderReady = async (): Resolved => ok([{ kind: "ready" }]);
export const reportVariantWithoutProduct = async (): Resolved => ok(report({ kind: "variant_only" }));
export const reportUnnamedAdd = async (): Resolved => ok(report({ kind: "unnamed_add" }));
/** Offered instead of the item actions when the order has no items; the order domain reports the missing or closed order. */
export const reportItemChangeWithoutOrder = async (): Resolved => ok(cannotApply(unclear(true, null)));
