import { z } from "zod";
import { ok } from "@shared/functional";
import type { Money } from "@shared/money";
import type { Result } from "@shared/result";
import { defineTool, defineToolRegistry, type RegisteredTool, type ToolRegistry } from "@core/src/shared/ai-tools/application/tool-registry";
import { parseMentionedPrice, type MentionedPriceArgs } from "@core/src/features/orders/domain/mentioned-price";
import type { ChangeVariantResolution, ReportOutcome, ResolvedChatAction } from "@core/src/features/orders/domain/chat-order";
import type { ProductIdentification } from "@core/src/features/orders/domain/chat-message-outcome";
import type { PositiveInteger } from "@core/src/features/orders/domain/order";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";
import type { ProductMatcherError, ProductWithSellableVariants, VariantResolution } from "@core/src/features/products/domain/text-identification";
import type { identifyProductsInText, findTopTextCandidate } from "@core/src/features/products/application/identify-product-in-text";
import type { resolveVariant } from "@core/src/features/products/application/resolve-variant";

type PersistenceError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;

/** What a message is, once its photo (if any) is identified. A photo that matched nothing asks nothing of the models. */
export type ChatMessageKind = "photo_product" | "photo_not_product" | "text";

/** One line of the chat's open order as the models see it: `label` is how they refer to it. */
export type ChatContextItem = Readonly<{
  label: string;
  variantId: VariantId;
  productName: string;
  variantAttributes: Readonly<Record<string, string>>;
  quantity: number;
  unitPrice: Money;
}>;

/** A product a photo shows, with the sellable variants a caption can choose from. */
export type ShownProduct = Readonly<{
  product: ProductWithSellableVariants;
  /** The variant printed on a QR label; a caption that names another variant wins over it. */
  preselectedVariantId: VariantId | null;
  identification: ProductIdentification;
}>;

export type ChatToolContext = Readonly<{
  kind: ChatMessageKind;
  caption: string | null;
  items: readonly ChatContextItem[];
  shown: readonly ShownProduct[];
}>;

export type ToolResolveError = PersistenceError | ProductMatcherError;

/** Capabilities the tools use outside orders; text tools only add tools, never dependencies. */
export type ChatToolDependencies = Readonly<{
  loadSellableVariants: (productIds: readonly ProductId[]) => Promise<Result<readonly ProductWithSellableVariants[], PersistenceError>>;
  resolveVariant: (input: Parameters<typeof resolveVariant>[0], signal: AbortSignal) => Promise<Result<VariantResolution, ProductMatcherError>>;
  identifyProductsInText: (lines: Parameters<typeof identifyProductsInText>[0], signal: AbortSignal) => ReturnType<typeof identifyProductsInText>;
  findTopTextCandidate: (mention: string) => ReturnType<typeof findTopTextCandidate>;
}>;

export type ChatToolRegistry = ToolRegistry<ChatToolContext, ResolvedChatAction, ToolResolveError>;
export type ChatTool = RegisteredTool<ChatToolContext, ResolvedChatAction, ToolResolveError>;

/** The kinds of message each tool is offered for. */
export const chatToolKinds: Readonly<Record<string, readonly ChatMessageKind[]>> = {
  add_shown_product: ["photo_product"],
  add_shown_product_with_details: ["photo_product"],
  decline_shown_product: ["photo_product"],
  report_request_with_non_product_image: ["photo_not_product"],
  no_intent: ["photo_product", "photo_not_product", "text"],
};

/** The registered tools offered for a kind of message. */
export function toolsForKind(registry: ChatToolRegistry, kind: ChatMessageKind): readonly ChatTool[] {
  return registry.tools.filter((tool) => chatToolKinds[tool.name]?.includes(kind));
}

/** A caption without a letter or digit (an emoji, punctuation) says nothing a model could read. */
export const hasReadableText = (value: string | null): value is string => value !== null && /[\p{L}\p{N}]/u.test(value);

const mentionedPriceArgs = z.object({
  amount: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/),
  units: z.number().int().min(1),
  currency: z.enum(["order_currency", "other"]),
});

const detailsArgs = z.object({
  variantWords: z.array(z.string().max(60)).max(5),
  quantity: z.number().int().min(1).nullable(),
  perEach: z.boolean(),
  mentionedPrice: mentionedPriceArgs.nullable(),
});
type DetailsArgs = z.output<typeof detailsArgs>;

const noArgs = z.object({});

const report = (outcome: ReportOutcome): readonly ResolvedChatAction[] => [{ kind: "report", outcome }];

/** The variant a change moves to, as the order domain names it: a failed resolution keeps the product to report. */
export function toChangeVariantResolution(resolution: VariantResolution, productId: ProductId): ChangeVariantResolution {
  switch (resolution.kind) {
    case "resolved": return { kind: "resolved", item: resolution.item };
    case "missing": return { kind: "missing", productId };
    case "not_available": return { kind: "not_available", productId };
  }
}

type Details = Readonly<{ words: readonly string[]; quantity: number | null; perEach: boolean; mentionedPrice: MentionedPriceArgs | null }>;

/** Adds what the photo shows. The variant, quantity and price come only from the caption; the product always comes from the photo. */
async function addShownProducts(context: ChatToolContext, deps: ChatToolDependencies, signal: AbortSignal, details: Details): Promise<Result<readonly ResolvedChatAction[], ToolResolveError>> {
  const resolutions = await Promise.all(context.shown.map((entry) =>
    deps.resolveVariant({ product: entry.product, words: details.words, preselectedVariantId: entry.preselectedVariantId }, signal)));
  const actions: ResolvedChatAction[] = [];
  for (const [index, entry] of context.shown.entries()) {
    const resolution = resolutions[index]!;
    if (!resolution.success) return resolution;
    const { productId } = entry.identification;
    if (resolution.data.kind !== "resolved") {
      actions.push(...report({ kind: resolution.data.kind === "missing" ? "variant_missing" : "variant_not_available", productId, identification: entry.identification }));
      continue;
    }
    const item = resolution.data.item;
    const single = context.shown.length === 1;
    // «2 de cada uno» spreads over the products of the photo; a bare quantity is only unambiguous for a single product.
    const quantity = (details.perEach || single ? details.quantity ?? 1 : 1) as PositiveInteger;
    const mentionedPrice = single && details.mentionedPrice ? parseMentionedPrice(details.mentionedPrice, item.unitPrice.currency) : null;
    actions.push({ kind: "add", item, quantity, mentionedPrice, identification: entry.identification });
  }
  return ok(actions);
}

/** The tool registry of chat messages. Its text tools are added by the text interpretation task. */
export function createChatToolRegistry(deps: ChatToolDependencies): ChatToolRegistry {
  return defineToolRegistry<ChatToolContext, ResolvedChatAction, ToolResolveError>([
    defineTool({
      name: "add_shown_product",
      description: "The buyer wants the product in the photo. The caption states no variant, quantity or price for it.",
      args: { kind: "none" }, schema: () => noArgs,
      resolve: (_args, context, signal) => addShownProducts(context, deps, signal, { words: [], quantity: null, perEach: false, mentionedPrice: null }),
    }),
    defineTool({
      name: "add_shown_product_with_details",
      description: "The caption states a variant (size, color), a quantity (including «2 de cada uno») or a price for the product in the photo. "
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
      description: "The image is not a product and the caption asks to add, remove or change something in the order.",
      args: { kind: "none" }, schema: () => noArgs,
      resolve: async () => ok(report({ kind: "image_with_request" })),
    }),
    defineTool({
      name: "no_intent",
      description: "Greetings, questions, addresses, thanks, payment reports: the message asks nothing of the order.",
      args: { kind: "none" }, schema: () => noArgs,
      resolve: async () => ok(report({ kind: "no_intent" })),
    }),
  ]);
}
