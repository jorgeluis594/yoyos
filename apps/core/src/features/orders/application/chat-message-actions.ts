import { ok } from "@shared/functional";
import type { RegisteredTool, ToolRegistry } from "@core/src/shared/ai-tools/application/tool-registry";
import type { ResolvedChatAction } from "@core/src/features/orders/domain/chat-order";
import type { PositiveInteger } from "@core/src/features/orders/domain/order";
import type { CatalogItem } from "@core/src/features/products/domain/image-identification";
import type { ChatToolContext, ChatToolDependencies, ChatMessageKind, ShownProduct, ToolResolveError } from "@core/src/features/orders/application/chat-tool-types";
import {
  addProducts, changeItemQuantity, changeItemVariant, markOrderReady, priceOf, removeItem, report, reportItemChangeWithoutOrder, reportUnnamedAdd,
  reportVariantWithoutProduct, setItemMentionedPrice,
  type AddProductsInput, type ChangeItemQuantityInput, type ChangeItemVariantInput, type RemoveItemInput, type Resolved, type SetItemMentionedPriceInput, type StatedPrice,
} from "@core/src/features/orders/application/chat-text-actions";

export type ChatToolRegistry = ToolRegistry<ChatToolContext, ResolvedChatAction, ToolResolveError>;
export type ChatTool = RegisteredTool<ChatToolContext, ResolvedChatAction, ToolResolveError>;

/** When a tool is offered: the kinds of message it serves and, when it matters, whether the open order has items. */
type ToolOffer = Readonly<{ kinds: readonly ChatMessageKind[]; items?: "some" | "none" }>;

/**
 * Tools that act on an item are offered only when the order has items, and one report takes their place otherwise: every offered tool
 * spreads the Decision's confidence, and an item tool fits «quiero 3 mochilas» or «a 45 soles» almost as well as adding does.
 * The keys are the actions' names, which are also the names of their tools.
 */
export const chatToolOffers = {
  add_shown_product: { kinds: ["photo_product"] },
  add_shown_product_with_details: { kinds: ["photo_product"] },
  decline_shown_product: { kinds: ["photo_product"] },
  report_request_with_non_product_image: { kinds: ["photo_not_product"] },
  no_intent: { kinds: ["photo_product", "photo_not_product", "text"] },
  add_products: { kinds: ["text"] },
  remove_item: { kinds: ["text"], items: "some" },
  change_item_quantity: { kinds: ["text"], items: "some" },
  change_item_variant: { kinds: ["text"], items: "some" },
  set_item_mentioned_price: { kinds: ["text"], items: "some" },
  mark_order_ready: { kinds: ["text"] },
  // With items, a variant text goes to change_item_variant, whose change question decides; the interpreter then runs this report.
  report_variant_without_product: { kinds: ["text"], items: "none" },
  report_unnamed_add: { kinds: ["text"] },
  report_item_change_without_order: { kinds: ["text"], items: "none" },
} as const satisfies Readonly<Record<string, ToolOffer>>;

/** The name of each chat action; its tool is registered under the same name. */
export type ChatToolName = keyof typeof chatToolOffers;

const offeredFor = (offer: ToolOffer | undefined, context: Pick<ChatToolContext, "kind" | "items">) =>
  !!offer && offer.kinds.includes(context.kind) && (!offer.items || (offer.items === "some") === (context.items.length > 0));

/** The registered tools offered for a message, by its kind and the items of its open order. */
export function toolsFor(registry: ChatToolRegistry, context: Pick<ChatToolContext, "kind" | "items">): readonly ChatTool[] {
  return registry.tools.filter((tool) => offeredFor((chatToolOffers as Readonly<Record<string, ToolOffer>>)[tool.name], context));
}

/** A caption without a letter or digit (an emoji, punctuation) says nothing a model could read. */
export const hasReadableText = (value: string | null): value is string => value !== null && /[\p{L}\p{N}]/u.test(value);

/** What a caption says about the product in the photo; with no details the photo's product is added as shown. */
export type ShownProductDetails = Readonly<{ variantWords: readonly string[]; quantity: number | null; perEach: boolean; mentionedPrice: StatedPrice | null }>;
const noDetails: ShownProductDetails = { variantWords: [], quantity: null, perEach: false, mentionedPrice: null };

/** Adds what the photo shows. The variant, quantity and price come only from the caption; the product always comes from the photo. */
export async function addShownProducts(details: ShownProductDetails, context: ChatToolContext, deps: ChatToolDependencies, signal: AbortSignal): Resolved {
  const resolutions = await Promise.all(context.shown.map((entry) =>
    deps.resolveVariant({ product: entry.product, words: details.variantWords, preselectedVariantId: entry.preselectedVariantId }, signal)));
  const resolved: Array<Readonly<{ entry: ShownProduct; item: CatalogItem }>> = [];
  const actions: ResolvedChatAction[] = [];
  for (const [index, entry] of context.shown.entries()) {
    const resolution = resolutions[index]!;
    if (!resolution.success) return resolution;
    const { productId } = entry.identification;
    if (resolution.data.kind !== "resolved") {
      actions.push(...report({ kind: resolution.data.kind === "missing" ? "variant_missing" : "variant_not_available", productId, identification: entry.identification }));
      continue;
    }
    // Labels of one product whose caption names a variant resolve to that same variant: it is added once, not once per label.
    const item = resolution.data.item;
    if (!resolved.some((other) => other.item.variantId === item.variantId)) resolved.push({ entry, item });
  }
  // A quantity or price is only unambiguous for a single thing; «tres de cada uno» spreads over the products of the photo.
  const single = resolved.length + actions.length === 1;
  for (const { entry, item } of resolved) {
    const quantity = (details.perEach || single ? details.quantity ?? 1 : 1) as PositiveInteger;
    const mentionedPrice = single ? priceOf(details.mentionedPrice, item.unitPrice.currency) : null;
    actions.push({ kind: "add", item, quantity, mentionedPrice, identification: entry.identification });
  }
  return ok(actions);
}

const noIntent = async (): Resolved => ok(report({ kind: "no_intent" }));

type Action<Input> = (input: Input, context: ChatToolContext, signal: AbortSignal) => Resolved;
type Report = () => Resolved;

/** Every chat action, bound to its dependencies: what a tool runs once the models' arguments are validated and mapped. */
export type ChatToolActions = Readonly<{
  addShownProduct: (context: ChatToolContext, signal: AbortSignal) => Resolved;
  addShownProductWithDetails: Action<ShownProductDetails>;
  declineShownProduct: Report;
  reportRequestWithNonProductImage: Report;
  noIntent: Report;
  addProducts: Action<AddProductsInput>;
  removeItem: Action<RemoveItemInput>;
  changeItemQuantity: Action<ChangeItemQuantityInput>;
  changeItemVariant: Action<ChangeItemVariantInput>;
  setItemMentionedPrice: Action<SetItemMentionedPriceInput>;
  markOrderReady: Report;
  reportVariantWithoutProduct: Report;
  reportUnnamedAdd: Report;
  reportItemChangeWithoutOrder: Report;
}>;

/** The chat actions over the capabilities they read through; they only read and answer with actions. */
export function createChatToolActions(deps: ChatToolDependencies): ChatToolActions {
  return {
    addShownProduct: (context, signal) => addShownProducts(noDetails, context, deps, signal),
    addShownProductWithDetails: (details, context, signal) => addShownProducts(details, context, deps, signal),
    declineShownProduct: noIntent,
    reportRequestWithNonProductImage: async () => ok(report({ kind: "image_with_request" })),
    noIntent,
    addProducts: (input, context, signal) => addProducts(input, context, deps, signal),
    removeItem: (input, context) => removeItem(input, context, deps),
    changeItemQuantity: (input, context) => changeItemQuantity(input, context, deps),
    changeItemVariant: (input, context, signal) => changeItemVariant(input, context, deps, signal),
    setItemMentionedPrice: (input, context) => setItemMentionedPrice(input, context, deps),
    markOrderReady,
    reportVariantWithoutProduct,
    reportUnnamedAdd,
    reportItemChangeWithoutOrder,
  };
}
