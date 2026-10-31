import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { ChatMessageOutcome } from "@core/src/features/orders/domain/chat-message-outcome";
import { applyChatActions, type ChatOrderLimits, type ChatOrderTarget, type ResolvedChatAction } from "@core/src/features/orders/domain/chat-order";
import { pendingLife, type PhotoLeft } from "@core/src/features/orders/domain/chat-pendings";
import { checkReaderAnswer, type ChatReadingContext, type ReaderAction, type ReaderAnswer, type ReadingItem, type ReadingProduct } from "@core/src/features/orders/domain/chat-reading";
import type { ChatPending, ChatPendingId, ChatPendings } from "@core/src/features/orders/domain/chat-pendings";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import { isOpenForMessageItems, type ChatId } from "@core/src/features/orders/domain/message-order";
import type { CompanyId, ContactId, OrderId, OrderItemId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import { buildPendingOrder, type OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { AttributeChoice } from "@core/src/features/orders/domain/pending-transitions";
import type { StatedPrice } from "@core/src/features/orders/domain/mentioned-price";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";

/** Domain scenarios of the chat reading: a small catalog, a chat with its order and pendings, and fixed reader answers. */
export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const money = (amount: number) => ({ amount, currency: "PEN" as const });

type Attributes = Readonly<Record<string, readonly string[]>>;
type ProductSpec = Readonly<{ name: string; price: number; attributes: Attributes }>;
const specs = {
  polo: { name: "Polo básico", price: 35, attributes: { Talla: ["M", "L"], Color: ["Negro", "Blanco"] } },
  oversize: { name: "Polo oversize", price: 45, attributes: { Talla: ["M", "L", "XL"], Color: ["Verde"] } },
  premium: { name: "Polo premium", price: 55, attributes: { Talla: ["L"], Color: ["Negro"] } },
  gorra: { name: "Gorra trucker", price: 25, attributes: { Color: ["Rojo", "Negro"] } },
  snapback: { name: "Gorra snapback", price: 30, attributes: { Color: ["Azul"] } },
  polera: { name: "Polera con capucha", price: 75, attributes: { Talla: ["M", "L"] } },
  medias: { name: "Medias deportivas pack x3", price: 15, attributes: {} },
} as const satisfies Record<string, ProductSpec>;
export type ProductKey = keyof typeof specs;
export const productKeys = Object.keys(specs) as readonly ProductKey[];

const combinations = (attributes: Attributes): readonly Readonly<Record<string, string>>[] =>
  Object.entries(attributes).reduce<readonly Readonly<Record<string, string>>[]>(
    (rows, [name, values]) => rows.flatMap((row) => values.map((value) => ({ ...row, [name]: value }))), [{}]);

/** The key products supplies with a product: lower case without accents (the fixtures stand in for `productNameKey`). */
export const nameKeyOf = (name: string) => name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const buildProduct = (key: ProductKey, index: number): ReadingProduct => {
  const spec: ProductSpec = specs[key];
  return { ref: `P${index + 1}`, shown: false, shownVariantId: null, identification: null, productId: id(100 + index) as ProductId, name: spec.name, nameKey: nameKeyOf(spec.name), sellable: true,
    attributes: Object.entries(spec.attributes).map(([name, values]) => ({ name, values })),
    variants: combinations(spec.attributes).map((variantAttributes, variant) => ({ variantId: id(1000 + index * 20 + variant) as VariantId, productName: spec.name,
      variantAttributes, sku: null, unitPrice: money(spec.price) })) };
};

export const catalog: Readonly<Record<ProductKey, ReadingProduct>> = Object.fromEntries(productKeys.map((key, index) => [key, buildProduct(key, index)])) as Record<ProductKey, ReadingProduct>;
export const productId = (key: ProductKey): ProductId => catalog[key].productId;
export const variantOf = (key: ProductKey, attributes: Readonly<Record<string, string>> = {}) => {
  const found = catalog[key].variants.find((variant) => Object.entries(attributes).every(([name, value]) => variant.variantAttributes[name] === value));
  if (!found) throw new Error(`No ${key} variant for ${JSON.stringify(attributes)}`);
  return found;
};

/** Days a pending without an order lasts. */
export const pendingTtlMs = 7 * 24 * 3600_000;
export const limits: ChatOrderLimits = { maxItemQuantity: 99 as PositiveInteger };
export const t0 = new Date("2026-10-28T12:00:00Z");
export const chatId = id(50) as ChatId;
const seed = { number: 1023 as OrderNumber, companyId: id(2) as CompanyId, sellerId: "seller" as UserId, chatId, contactId: id(60) as ContactId };

export type ReaderAdd = Readonly<{ product: ProductKey; attributes?: Readonly<Record<string, string>>; quantity?: number | null; price?: StatedPrice | null }>;
const choices = (attributes: Readonly<Record<string, string>> = {}): readonly AttributeChoice[] => Object.entries(attributes).map(([name, value]) => ({ name, value }));

/** Builders of the reader's actions; refs follow the catalog order (`P1…`) and the chat's pendings order (`Q1…`). */
export const reader = {
  add: (add: ReaderAdd): ReaderAction => ({ kind: "add", product: { kind: "ref", ref: catalog[add.product].ref }, attributes: choices(add.attributes), quantity: add.quantity ?? null, price: add.price ?? null }),
  oneOf: (products: readonly ProductKey[], attributes?: Readonly<Record<string, string>>, quantity: number | null = null): ReaderAction => ({ kind: "add", attributes: choices(attributes), quantity, price: null,
    product: { kind: "one_of", refs: products.map((key) => catalog[key].ref) as unknown as [string, string, ...string[]] } }),
  complete: (pending: number, attributes?: Readonly<Record<string, string>>, quantity: number | null = null, product: ProductKey | null = null, price: StatedPrice | null = null): ReaderAction =>
    ({ kind: "complete_pending", pending: `Q${pending}`, product: product ? catalog[product].ref : null, attributes: choices(attributes), quantity, price }),
  decline: (pending: number): ReaderAction => ({ kind: "decline_pending", pending: `Q${pending}` }),
  ready: { kind: "ready" } as ReaderAction,
  payment: { kind: "payment_request" } as ReaderAction,
  notAllowed: { kind: "not_allowed" } as ReaderAction,
  /** A quantity change on an item (`I1…`), a pending (`Q1…`) or no named line. */
  change: (target: `I${number}` | `Q${number}` | "unnamed" | "not_in_order", mode: "increase" | "set" | "decrease", quantity: number): ReaderAction => ({ kind: "change_quantity", mode, quantity,
    target: target === "unnamed" || target === "not_in_order" ? { kind: target } : target.startsWith("Q") ? { kind: "pending", ref: target } : { kind: "ref", ref: target } }),
  say: (...actions: ReaderAction[]): ReaderAnswer => {
    const [first, ...rest] = actions;
    if (!first) throw new Error("An answer needs an action");
    return { kind: "actions", actions: [first, ...rest], moreActions: false };
  },
};
export const stated = (amount: string, per: StatedPrice["per"] = "not_explicit"): StatedPrice => ({ amount, currency: "not_named", per });

export type Reading = Readonly<{ kind?: ChatReadingContext["kind"]; shown?: readonly (readonly [ProductKey, Readonly<Record<string, string>>?])[]; captionDoubt?: boolean; after?: number;
  /** What the photo just sent left, as the use case would give it to the reader. */
  photoJustSent?: PhotoLeft | null;
  /** The pendings the transaction finds under the lock, when they differ from the ones the reader saw. */
  underLock?: ChatPendings }>;
export type Said = Readonly<{ outcomes: readonly ChatMessageOutcome[]; kinds: readonly ChatMessageOutcome["kind"][]; actions: readonly ResolvedChatAction[] }>;
export type Chat = ReturnType<typeof createChat>;

export type ChatStart = Readonly<{ items?: readonly (readonly [ProductKey, Readonly<Record<string, string>>, number])[]; pendings?: readonly ChatPending[]; readyRemembered?: boolean; unsellable?: readonly ProductKey[]; deleted?: readonly ProductKey[]; orders?: readonly OrderAggregate[] }>;

/** A chat that reads fixed reader answers through the real check and the real order transitions. */
export function createChat(start: ChatStart = {}) {
  let now = t0;
  let counter = 500;
  let pendings: ChatPendings = { pendings: start.pendings ?? [], readyRemembered: start.readyRemembered ?? false, lastIncomingPhoto: null };
  /** Every order of the chat, oldest first; the last one is the chat's latest. */
  let orders: OrderAggregate[] = start.orders ? [...start.orders] : start.items?.length ? [orderOf(start.items)] : [];
  const unsellable = new Set(start.unsellable ?? []);
  const deleted = new Set(start.deleted ?? []);
  const ids = { newOrderId: () => id(900) as OrderId, newItemId: () => id(counter++) as OrderItemId, newPendingId: () => id(counter++) as ChatPendingId };
  const productByVariant = new Map<VariantId, ProductId>(productKeys.flatMap((key) => catalog[key].variants.map((variant): [VariantId, ProductId] => [variant.variantId, productId(key)])));

  const latest = (): OrderAggregate | null => orders.at(-1) ?? null;
  const readingItems = (): readonly ReadingItem[] => (latest()?.items ?? []).map((item, index) => ({ ref: `I${index + 1}`, variantId: item.variantId, productId: productByVariant.get(item.variantId) ?? null,
    productName: item.productName, variantAttributes: item.variantAttributes, quantity: item.quantity, unitPrice: item.unitPrice, photoJustSent: false }));

  const productsFor = (reading: Reading): readonly ReadingProduct[] => productKeys.filter((key) => !deleted.has(key)).map((key) => {
    const shown = reading.shown?.find(([shownKey]) => shownKey === key);
    const product: ReadingProduct = { ...catalog[key], sellable: !unsellable.has(key) };
    if (!shown) return product;
    const variant = shown[1] ? variantOf(key, shown[1]) : null;
    return { ...product, shown: true, shownVariantId: variant?.variantId ?? null, identification: { method: "qr", productId: product.productId, confidence: null } };
  });

  const target = (): ChatOrderTarget => {
    const last = latest();
    if (!last) return { kind: "none" };
    if (isOpenForMessageItems(last, chatId)) return { kind: "open", order: last, productIds: productByVariant };
    return last.cancelled ? { kind: "cancelled" } : { kind: "closed", orderId: last.id, number: last.number };
  };

  return {
    ref: (key: ProductKey) => catalog[key].ref,
    get pendings() { return pendings; },
    get order() { return latest(); },
    get orders() { return orders; },
    /** Changes the chat's latest order, the way a payment, a cancellation or a void would. */
    mutate(change: (order: OrderAggregate) => OrderAggregate) { orders = orders.map((order, index) => (index === orders.length - 1 ? change(order) : order)); },
    get now() { return now; },
    advance(ms: number) { now = new Date(now.getTime() + ms); },
    context(reading: Reading = {}): ChatReadingContext {
      return { kind: reading.kind ?? (reading.shown ? "photo_product" : "text"), text: "message", latestOrder: target().kind === "open" ? "open" : target().kind === "closed" ? "closed" : "none", items: readingItems(), photoJustSent: reading.photoJustSent ?? null, products: productsFor(reading), truncated: false,
        pendings: pendings.pendings.map((pending, index) => ({ ref: `Q${index + 1}`, pending, photoJustSent: false })) };
    },
    say(answer: ReaderAnswer, reading: Reading = {}): Said {
      if (reading.after) now = new Date(now.getTime() + reading.after);
      const life = pendingLife(pendings, { target: target(), openedSince: orders }, now, pendingTtlMs);
      pendings = { ...pendings, pendings: life.alive };
      const ended: ChatMessageOutcome[] = life.ended.map((entry) => ({ kind: "pending_ended", pendingId: entry.id, reason: entry.reason }));
      const actions = checkReaderAnswer(answer, this.context(reading), { captionDoubt: reading.captionDoubt ?? false });
      const applied = applyChatActions(target(), reading.underLock ?? pendings, actions, ids, now, limits, { ...seed, messageId: id(counter++) as ChatMessageId });
      if (!applied.success) throw new Error(applied.error.message);
      if (applied.data.createdOrder) orders = [...orders, applied.data.createdOrder];
      else if (applied.data.target.kind === "open") orders = orders.map((order) => (order.id === (applied.data.target as { order: OrderAggregate }).order.id ? (applied.data.target as { order: OrderAggregate }).order : order));
      pendings = applied.data.pendings;
      const outcomes = [...ended, ...applied.data.outcomes];
      return { outcomes, kinds: outcomes.map((outcome) => outcome.kind), actions };
    },
    /** `Polo básico · M · Negro · ×1`, the way the order shows an item. */
    items: () => (latest()?.items ?? []).map((item) => [item.productName, ...Object.values(item.variantAttributes), `×${item.quantity}`].join(" · ")),
    /** `Polo básico ×2 {Talla: M}` for each pending, in order. */
    pendingLines: () => pendings.pendings.map((pending) => {
      const name = pending.subject.kind === "variant" ? catalog[productKeys.find((key) => productId(key) === (pending.subject as { productId: ProductId }).productId)!].name : "producto dudoso";
      return `${name} ×${pending.quantity} ${JSON.stringify(pending.known)}`;
    }),
  };

  function orderOf(lines: NonNullable<ChatStart["items"]>): OrderAggregate {
    const built = buildPendingOrder({ number: 1023 as OrderNumber, id: id(1) as OrderId, companyId: id(2) as CompanyId, sellerId: "seller" as UserId, customer: { kind: "general_public" }, createdAt: t0,
      items: lines.map(([key, attributes, quantity], index) => ({ id: id(700 + index) as OrderItemId, ...variantOf(key, attributes), quantity })) });
    if (!built.success) throw new Error(built.error.message);
    return { ...built.data, chatId };
  }
}

/** A stored pending, the way an earlier message left it. */
export function pendingOf(key: ProductKey, fields: Partial<Pick<ChatPending, "known" | "price" | "lastChangedAt" | "order">> & Readonly<{ n?: number; quantity?: number }> = {}): ChatPending {
  const n = fields.n ?? 1;
  return { id: id(300 + n) as ChatPendingId, subject: { kind: "variant", productId: productId(key) }, known: fields.known ?? {}, quantity: (fields.quantity ?? 1) as PositiveInteger, price: fields.price ?? null,
    order: fields.order ?? null, lastChangedAt: fields.lastChangedAt ?? t0, sourceMessageId: id(80 + n) as ChatMessageId, requestId: id(300 + n) as ChatPendingId };
}

export function doubtfulPendingOf(keys: readonly [ProductKey, ProductKey, ...ProductKey[]], n = 1): ChatPending {
  return { ...pendingOf(keys[0], { n }), subject: { kind: "product", candidates: keys.map(productId) as unknown as readonly [ProductId, ProductId, ...ProductId[]] } };
}
