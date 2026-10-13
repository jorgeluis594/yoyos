import type { Money } from "@shared/money";
import type { VariantId } from "@core/src/features/products/domain/product";

export type CatalogItem = Readonly<{ variantId: VariantId; productName: string; variantAttributes: Readonly<Record<string, string>>; sku: string | null; unitPrice: Money }>;
