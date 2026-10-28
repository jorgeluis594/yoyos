import { z } from "zod";
import { ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { defineTool, defineToolRegistry, type RegisteredTool, type ToolRegistry } from "@core/src/shared/ai-tools/application/tool-registry";
import type { ReportOutcome, ResolvedChatAction } from "@core/src/features/orders/domain/chat-order";
import type { PositiveInteger } from "@core/src/features/orders/domain/order";
import type { CatalogItem } from "@core/src/features/products/domain/image-identification";
import type { ChatToolContext, ChatToolDependencies, ChatMessageKind, ShownProduct, ToolResolveError } from "@core/src/features/orders/application/chat-tool-types";
import { createChatTextTools, mentionedPriceArgs, priceOf } from "@core/src/features/orders/application/chat-text-tools";

export { toChangeVariantResolution } from "@core/src/features/orders/application/chat-text-tools";

export type ChatToolRegistry = ToolRegistry<ChatToolContext, ResolvedChatAction, ToolResolveError>;
export type ChatTool = RegisteredTool<ChatToolContext, ResolvedChatAction, ToolResolveError>;

/** When a tool is offered: the kinds of message it serves and, when it matters, whether the open order has items. */
type ToolOffer = Readonly<{ kinds: readonly ChatMessageKind[]; items?: "some" | "none" }>;

/**
 * Tools that act on an item are offered only when the order has items, and one report takes their place otherwise: every offered tool
 * spreads the Decision's confidence, and an item tool fits «quiero 3 mochilas» or «a 45 soles» almost as well as adding does.
 */
export const chatToolOffers: Readonly<Record<string, ToolOffer>> = {
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
};

const offeredFor = (offer: ToolOffer | undefined, context: Pick<ChatToolContext, "kind" | "items">) =>
  !!offer && offer.kinds.includes(context.kind) && (!offer.items || (offer.items === "some") === (context.items.length > 0));

/** The registered tools offered for a message, by its kind and the items of its open order. */
export function toolsFor(registry: ChatToolRegistry, context: Pick<ChatToolContext, "kind" | "items">): readonly ChatTool[] {
  return registry.tools.filter((tool) => offeredFor(chatToolOffers[tool.name], context));
}

/** A caption without a letter or digit (an emoji, punctuation) says nothing a model could read. */
export const hasReadableText = (value: string | null): value is string => value !== null && /[\p{L}\p{N}]/u.test(value);

const detailsArgs = z.object({
  variantWords: z.array(z.string().max(60)).max(5),
  quantity: z.number().int().min(1).nullable(),
  perEach: z.boolean(),
  mentionedPrice: mentionedPriceArgs.nullable(),
});
type DetailsArgs = z.output<typeof detailsArgs>;

const noArgs = z.object({});

const report = (outcome: ReportOutcome): readonly ResolvedChatAction[] => [{ kind: "report", outcome }];

type Details = Readonly<{ words: readonly string[]; quantity: number | null; perEach: boolean; mentionedPrice: DetailsArgs["mentionedPrice"] }>;

/** Adds what the photo shows. The variant, quantity and price come only from the caption; the product always comes from the photo. */
async function addShownProducts(context: ChatToolContext, deps: ChatToolDependencies, signal: AbortSignal, details: Details): Promise<Result<readonly ResolvedChatAction[], ToolResolveError>> {
  const resolutions = await Promise.all(context.shown.map((entry) =>
    deps.resolveVariant({ product: entry.product, words: details.words, preselectedVariantId: entry.preselectedVariantId }, signal)));
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

/** The tool registry of chat messages: the photo tools, `no_intent` and the text tools. */
export function createChatToolRegistry(deps: ChatToolDependencies): ChatToolRegistry {
  return defineToolRegistry<ChatToolContext, ResolvedChatAction, ToolResolveError>([
    defineTool({
      name: "add_shown_product",
      description: "The buyer wants the product in the photo, and the caption gives no size, color, quantity or price for it.",
      args: { kind: "none" }, schema: () => noArgs,
      resolve: (_args, context, signal) => addShownProducts(context, deps, signal, { words: [], quantity: null, perEach: false, mentionedPrice: null }),
    }),
    defineTool({
      name: "add_shown_product_with_details",
      description: "The caption gives a size, color, quantity (including «tres de cada uno») or price for the product in the photo, even in one or two words "
        + "(«en XS», «talla XS», «XS celeste», «3»). "
        + "Give the variant words as written, the quantity only if stated, perEach true when the quantity is for each product of the photo, and the price as stated.",
      args: { kind: "extracted" }, schema: () => detailsArgs,
      resolve: (args: DetailsArgs, context, signal) => addShownProducts(context, deps, signal,
        { words: args.variantWords, quantity: args.quantity, perEach: args.perEach, mentionedPrice: args.mentionedPrice }),
    }),
    defineTool({
      name: "decline_shown_product",
      description: "The caption says the buyer does not want the product in the photo.",
      args: { kind: "none" }, schema: () => noArgs,
      resolve: async () => ok(report({ kind: "no_intent" })),
    }),
    defineTool({
      name: "report_request_with_non_product_image",
      description: "The image is not a product and the caption asks to add, remove or change something in the order, "
        + "even when it names the product to add («y súmale una mochila»).",
      args: { kind: "none" }, reportOnly: true, schema: () => noArgs,
      resolve: async () => ok(report({ kind: "image_with_request" })),
    }),
    defineTool({
      name: "no_intent",
      description: "The message asks for nothing to be added, removed or changed: greetings, questions about prices, availability or delivery, addresses, thanks, "
        + "payment reports. Never a message that names a product to buy, even without a verb («chaleco acolchado celeste XS x3», a list of products), "
        + "or that only gives a size, color or quantity, even in one word («celeste», «en XS», «talla XS»). "
        + "A question followed by a request («¿todavía tienes la mochila? resérvamela entonces») asks for the product.",
      args: { kind: "none" }, schema: () => noArgs,
      resolve: async () => ok(report({ kind: "no_intent" })),
    }),
    ...createChatTextTools(deps),
  ]);
}
