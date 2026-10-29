import type { Currency, Money } from "@shared/money";
import type { ProductIdentification } from "@core/src/features/orders/domain/chat-message-outcome";
import type { ChatPending } from "@core/src/features/orders/domain/chat-pendings";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";
import type { ProductForReading } from "@core/src/features/products/domain/reading-product";

/** A short reference valid for one reading only: "P1" products, "I1" items, "Q1" pendings. */
export type ReadingRef = string;

export type ReadingProduct = ProductForReading & Readonly<{
  ref: ReadingRef;
  /** The product a photo showed. */
  shown: boolean;
  shownVariantId: VariantId | null;
  identification: ProductIdentification | null;
}>;
export type ReadingItem = Readonly<{
  ref: ReadingRef;
  variantId: VariantId;
  productId: ProductId | null;
  productName: string;
  variantAttributes: Readonly<Record<string, string>>;
  quantity: number;
  unitPrice: Money;
}>;
export type ReadingPending = Readonly<{ ref: ReadingRef; pending: ChatPending }>;

export type ChatReadingContext = Readonly<{
  kind: "text" | "photo_product" | "photo_not_product";
  /** The buyer's words: the text, or the photo's caption. Only the reader adapter reads it; domain logic never does. */
  text: string | null;
  items: readonly ReadingItem[];
  pendings: readonly ReadingPending[];
  products: readonly ReadingProduct[];
  /** True when the product ceiling cut some of the products the reading wanted. */
  truncated: boolean;
}>;

export type AttributeChoice = Readonly<{ name: string; value: string }>;
export type StatedPrice = Readonly<{ amount: string; currency: "not_named" | Currency | "other"; per: "unit" | "lot" | "not_explicit" }>;
export type ReaderProduct =
  | Readonly<{ kind: "ref"; ref: ReadingRef }>
  | Readonly<{ kind: "one_of"; refs: readonly [ReadingRef, ReadingRef, ...ReadingRef[]] }>
  | Readonly<{ kind: "not_in_catalog" }>
  | Readonly<{ kind: "unnamed" }>;
export type ReaderItem = Readonly<{ kind: "ref"; ref: ReadingRef }> | Readonly<{ kind: "unnamed" }> | Readonly<{ kind: "not_in_order" }>;

export type ReaderAction =
  | Readonly<{ kind: "add"; product: ReaderProduct; attributes: readonly AttributeChoice[]; quantity: number | null; price: StatedPrice | null }>
  | Readonly<{ kind: "complete_pending"; pending: ReadingRef; product: ReadingRef | null; attributes: readonly AttributeChoice[]; quantity: number | null; price: StatedPrice | null }>
  | Readonly<{ kind: "decline_pending"; pending: ReadingRef }>
  | Readonly<{ kind: "decline_shown" }>
  | Readonly<{ kind: "remove"; item: ReaderItem; amount: "all" | "one" }>
  | Readonly<{ kind: "change_quantity"; item: ReaderItem; mode: "increase" | "set"; quantity: number }>
  | Readonly<{ kind: "change_variant"; item: ReaderItem; attributes: readonly AttributeChoice[]; price: StatedPrice | null }>
  | Readonly<{ kind: "set_price"; item: ReaderItem; price: StatedPrice }>
  | Readonly<{ kind: "ready" }>
  | Readonly<{ kind: "variant_only" }>
  | Readonly<{ kind: "variant_for_pendings"; pendings: readonly [ReadingRef, ReadingRef, ...ReadingRef[]] }>
  | Readonly<{ kind: "not_allowed" }>
  /** An action the reader returned incomplete or inconsistent for its kind; the check reports it as `invalid_action` (`unknown_reference`) and the rest of the answer still applies. */
  | Readonly<{ kind: "malformed" }>;

export type ReaderAnswer =
  /** At most 10 actions are applied; moreActions says the message asked for more. */
  | Readonly<{ kind: "actions"; actions: readonly [ReaderAction, ...ReaderAction[]]; moreActions: boolean }>
  | Readonly<{ kind: "no_intent" }>
  | Readonly<{ kind: "doubt" }>;
