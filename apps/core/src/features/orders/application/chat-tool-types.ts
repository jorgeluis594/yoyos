import type { Money } from "@shared/money";
import type { Result } from "@shared/result";
import type { ProductIdentification } from "@core/src/features/orders/domain/chat-message-outcome";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";
import type { ProductMatcherError, ProductWithSellableVariants, VariantResolution } from "@core/src/features/products/domain/text-identification";
import type { identifyProductsInText, findTopTextCandidate } from "@core/src/features/products/application/identify-product-in-text";
import type { resolveVariant } from "@core/src/features/products/application/resolve-variant";

type PersistenceError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;

export type ChatMessageKind = "photo_product" | "photo_not_product" | "text";

/** One line of the chat's open order as the models see it: `label` is how they refer to it. */
export type ChatContextItem = Readonly<{
  label: string;
  variantId: VariantId;
  /** Null when the variant no longer belongs to a product; a change that needs the product then degrades to an unclear item. */
  productId: ProductId | null;
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
  /** The buyer's words: a photo's caption, or the text of a text message. */
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
