import { z } from "zod";
import { currencies } from "@shared/money";
import { previewCardCount } from "@core/src/features/catalog/application/preview-catalog-cards";
import { publicStoreAppearanceSchema } from "@core/src/features/store-appearance/presentation/store-appearance-schemas";

// A catalog card as the preview draws it: the list fields of the buyer catalog and nothing more.
export const previewCardSchema = z.strictObject({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  imageUrl: z.url({ protocol: /^https?$/ }).nullable(),
  price: z.strictObject({
    kind: z.enum(["single", "from"]),
    amount: z.strictObject({ amount: z.number().finite(), currency: z.enum(currencies) }),
  }),
  soldOut: z.boolean(),
});

// Where the cards came from decides the label, so the two kinds are never mixed.
const productsSchema = z.strictObject({ kind: z.literal("products"), cards: z.array(previewCardSchema).min(1).max(previewCardCount) });
const samplesSchema = z.strictObject({ kind: z.literal("samples") });
const loadingSchema = z.strictObject({ kind: z.literal("loading") });

/** Answer of the `catalog-cards` resource route, and the cards the editor keeps in state once they are known. */
export const catalogPreviewCardsSchema = z.discriminatedUnion("kind", [productsSchema, samplesSchema]);
const catalogPreviewMessageSchema = z.discriminatedUnion("kind", [productsSchema, samplesSchema, loadingSchema]);

// Editor → preview iframe.
export const storePreviewMessageSchema = z.strictObject({
  type: z.literal("store-appearance:update"),
  appearance: publicStoreAppearanceSchema,
  surface: z.enum(["catalog", "checkout"]),
  state: z.enum(["review", "payment"]),
  catalog: catalogPreviewMessageSchema,
});

// Preview iframe → editor: ready to receive the state.
export const storePreviewReadySchema = z.strictObject({ type: z.literal("store-appearance:ready") });

export type PreviewCard = z.infer<typeof previewCardSchema>;
export type CatalogPreviewCards = z.infer<typeof catalogPreviewCardsSchema>;
export type StorePreviewMessage = z.infer<typeof storePreviewMessageSchema>;
export type PreviewSurface = StorePreviewMessage["surface"];
