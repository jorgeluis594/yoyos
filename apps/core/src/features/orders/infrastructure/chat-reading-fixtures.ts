import type { ChatReadingContext, ReadingProduct } from "@core/src/features/orders/domain/chat-reading";
import type { ChatPending } from "@core/src/features/orders/domain/chat-pendings";
import type { ChatPendingId } from "@core/src/features/orders/domain/chat-message-outcome";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { PositiveInteger } from "@core/src/features/orders/domain/order";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";

export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const productId = (n: number) => id(n) as ProductId;
const variant = (n: number, name: string, variantAttributes: Record<string, string>, amount: number) =>
  ({ variantId: id(1000 + n) as VariantId, productName: name, variantAttributes, sku: null, unitPrice: { amount, currency: "PEN" as const } });
const values = (attributes: Record<string, string>[]) => {
  const byName = new Map<string, string[]>();
  for (const combination of attributes) for (const [name, value] of Object.entries(combination)) {
    const list = byName.get(name) ?? [];
    if (!list.includes(value)) list.push(value);
    byName.set(name, list);
  }
  return [...byName].map(([name, list]) => ({ name, values: list }));
};
export const readingProduct = (n: number, name: string, combinations: [Record<string, string>, number][], over: Partial<ReadingProduct> = {}): ReadingProduct => ({
  productId: productId(n), name, sellable: true, ref: `P${n}`, shown: false, shownVariantId: null, identification: null,
  attributes: values(combinations.map(([attributes]) => attributes)),
  variants: combinations.map(([attributes, amount], index) => variant(n * 100 + index, name, attributes, amount)),
  ...over,
});
export const pending = (n: number, over: Partial<ChatPending>): ChatPending => ({
  id: id(5000 + n) as ChatPendingId, subject: { kind: "variant", productId: productId(1) }, known: {}, quantity: 1 as PositiveInteger, price: null,
  order: null, lastChangedAt: new Date("2026-10-28T10:00:00Z"), sourceMessageId: id(9) as ChatMessageId, requestId: id(5000 + n) as ChatPendingId, ...over,
});
export const context = (over: Partial<ChatReadingContext>): ChatReadingContext => ({ kind: "text", text: "hola", items: [], pendings: [], products: [], truncated: false, ...over });
