import { z } from "zod";
import type { BuyerLanguage } from "@core/src/features/orders/domain/reader/refs";

/** A question the seller may send the buyer, as structured data; presentation renders it in the buyer's language. Never holds buyer text. */
export type SuggestedQuestion = Readonly<{ language: BuyerLanguage } & (
  /** `values` is empty when the attribute has more than 3. */
  | { kind: "which_variant"; product: string; attribute: string; values: readonly string[] }
  /** Two to four products. */
  | { kind: "which_product"; products: readonly string[] }
  | { kind: "variant_unavailable"; product: string; asked: string; attribute: string; values: readonly string[] }
  | { kind: "variant_for_which"; attribute: string; value: string; products: readonly string[] }
  | { kind: "which_item_to_remove"; products: readonly string[] }
  | { kind: "which_product_for_value"; value: string; products: readonly string[] }
  | { kind: "another_of_which" }
  | { kind: "photo_product_name" }
  | { kind: "product_gone"; product: string })>;

const text = z.string().min(1).max(200);
const values = z.array(text).max(3);
const products = z.array(text).min(1).max(10);
const language = z.enum(["es", "pt"]);

export const suggestedQuestionSchema: z.ZodType<SuggestedQuestion> = z.discriminatedUnion("kind", [
  z.strictObject({ language, kind: z.literal("which_variant"), product: text, attribute: text, values }),
  z.strictObject({ language, kind: z.literal("which_product"), products: z.array(text).min(2).max(4) }),
  z.strictObject({ language, kind: z.literal("variant_unavailable"), product: text, asked: text, attribute: text, values }),
  z.strictObject({ language, kind: z.literal("variant_for_which"), attribute: text, value: text, products }),
  z.strictObject({ language, kind: z.literal("which_item_to_remove"), products }),
  z.strictObject({ language, kind: z.literal("which_product_for_value"), value: text, products }),
  z.strictObject({ language, kind: z.literal("another_of_which") }),
  z.strictObject({ language, kind: z.literal("photo_product_name") }),
  z.strictObject({ language, kind: z.literal("product_gone"), product: text }),
]);
