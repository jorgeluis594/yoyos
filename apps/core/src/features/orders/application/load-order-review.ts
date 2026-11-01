import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { SellableVariant } from "@core/src/features/orders/domain/catalog-order";
import type { ChatPending, ChatPendings } from "@core/src/features/orders/domain/chat-pendings";
import type { OrderItemChange } from "@core/src/features/orders/domain/message-changes";
import type { ChatId } from "@core/src/features/orders/domain/message-order";
import type { CompanyId, OrderId } from "@core/src/features/orders/domain/order";
import { reviewProjection, type OrderReviewProjection, type ReviewPoint } from "@core/src/features/orders/domain/order-review";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { TraceQuote } from "@core/src/features/orders/domain/reader/trace";
import type { SuggestedQuestion } from "@core/src/features/orders/domain/suggested-question";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";
import type { OrderAccess } from "@core/src/features/orders/application/create-order";
import type { OrderChanges } from "@core/src/features/orders/infrastructure/order-review-repository";

export type LoadOrderReviewInput = Readonly<{ orderId: OrderId; allRows?: boolean }>;
export type LoadOrderReviewError = Readonly<{ code: "ORDER_NOT_FOUND" | "PERSISTENCE_UNAVAILABLE" | "INVALID_STORED_DATA"; message: string }>;
export type ProductNames = Readonly<{ name: string; attributeNames: readonly string[] }>;

export type LoadOrderReviewDependencies = Readonly<{
  /** Reads the order, its changes, pendings and latest chat order from one committed snapshot, so `changesThrough` and the items revision describe the same state. */
  inSnapshot: <T>(read: () => Promise<T>) => Promise<T>;
  findOrder: (id: OrderId, companyId: CompanyId) => Promise<Result<OrderAggregate | null, LoadOrderReviewError>>;
  findOrderChanges: (orderId: OrderId, options: Readonly<{ allRows: boolean }>) => Promise<Result<OrderChanges, LoadOrderReviewError>>;
  findChatPendings: (chatId: ChatId) => Promise<Result<ChatPendings, LoadOrderReviewError>>;
  findLatestChatOrder: (chatId: ChatId) => Promise<Result<OrderId | null, LoadOrderReviewError>>;
  /** A missing or expired trace is `null`; it only removes the quotes. */
  findTraceQuotes: (messageId: ChatMessageId) => Promise<Result<readonly TraceQuote[] | null, LoadOrderReviewError>>;
  findSellableVariants: (ids: readonly VariantId[]) => Promise<Result<readonly SellableVariant[], LoadOrderReviewError>>;
  findProductNames: (ids: readonly ProductId[]) => Promise<Result<ReadonlyMap<ProductId, ProductNames>, LoadOrderReviewError>>;
  clock: () => Date;
  pendingTtlMs: number;
}>;

const pendingProductIds = (pending: ChatPending): readonly ProductId[] => (pending.subject.kind === "variant" ? [pending.subject.productId] : pending.subject.candidates);

/** The question a seller may send for a pending, from the catalog names. Buyer language is Spanish until the chat records it. */
export function questionOfPending(pending: ChatPending, names: ReadonlyMap<ProductId, ProductNames>): Pick<ReviewPoint, "product" | "missing" | "question"> {
  const named = pendingProductIds(pending).flatMap((productId) => { const found = names.get(productId); return found ? [found] : []; });
  if (pending.subject.kind === "variant") {
    const product = named[0];
    const known = new Set(Object.keys(pending.known).map((name) => name.toLowerCase()));
    const missing = (product?.attributeNames ?? []).filter((name) => !known.has(name.toLowerCase()));
    if (!product || missing.length === 0) return { product: product?.name ?? null, missing, question: { language: "es", kind: "photo_product_name" } };
    return { product: product.name, missing, question: { language: "es", kind: "which_variant", product: product.name, attribute: missing[0]!, values: [] } };
  }
  const products = named.map((entry) => entry.name);
  const question: SuggestedQuestion = products.length >= 2 ? { language: "es", kind: "which_product", products: products.slice(0, 4) } : { language: "es", kind: "another_of_which" };
  return { product: null, missing: [], question };
}

/** The review of one order: marks, points, products, «Cambios por mensajes» and the snapshot a confirmation compares. */
export async function loadOrderReview(input: LoadOrderReviewInput, access: OrderAccess, deps: LoadOrderReviewDependencies): Promise<Result<OrderReviewProjection, LoadOrderReviewError>> {
  const snapshot = await deps.inSnapshot(async () => {
    const found = await deps.findOrder(input.orderId, access.companyId);
    if (!found.success) return found;
    const order = found.data;
    if (!order) return err<LoadOrderReviewError>({ code: "ORDER_NOT_FOUND", message: "Order is not available" });
    const changes = await deps.findOrderChanges(input.orderId, { allRows: input.allRows ?? false });
    if (!changes.success) return changes;
    if (!order.chatId) return ok({ order, changes: changes.data, pendings: [] as readonly ChatPending[], latest: null });
    const [pendings, latest] = [await deps.findChatPendings(order.chatId), await deps.findLatestChatOrder(order.chatId)];
    if (!pendings.success) return pendings;
    if (!latest.success) return latest;
    return ok({ order, changes: changes.data, pendings: pendings.data.pendings, latest: latest.data });
  });
  if (!snapshot.success) return snapshot;
  const { order, changes, pendings, latest } = snapshot.data;

  const restored = changes.rows.flatMap((row) => row.changes.flatMap((change) => (change.before ? [change.before.variantId] : [])));
  const sellable = restored.length === 0 ? ok<readonly SellableVariant[]>([]) : await deps.findSellableVariants([...new Set(restored)]);
  if (!sellable.success) return sellable;
  const rowPendings = changes.rows.flatMap((row) => [...row.pendingsBefore, ...row.pendingsAfter]);
  const names = await deps.findProductNames([...new Set([...pendings, ...rowPendings].flatMap(pendingProductIds))]);
  if (!names.success) return names;
  const quotes = await findQuotes(changes.unreviewed, order, deps);

  return ok(reviewProjection({ order, latestChatOrderId: latest, pendings, unreviewed: changes.unreviewed, lastSeq: changes.lastSeq, hasPreviousReview: changes.hasPreviousReview, now: deps.clock(),
    pendingTtlMs: deps.pendingTtlMs, quoteOf: (change) => quotes.get(change.id) ?? null, describePoint: (pending) => questionOfPending(pending, names.data), rows: changes.rows,
    laterChanges: changes.laterChanges, sellable: sellable.data, moreRows: changes.moreRows }));
}

/** The buyer's words behind each doubtful change, while the trace exists. A missing trace or a failed read only removes the quote. */
async function findQuotes(unreviewed: readonly OrderItemChange[], order: OrderAggregate, deps: LoadOrderReviewDependencies): Promise<ReadonlyMap<OrderItemChange["id"], string>> {
  const quoted = unreviewed.filter((change) => change.decision.kind === "doubtful" && change.quoteId !== null && !order.cancelled && order.completedAt === null);
  const quotes = new Map<OrderItemChange["id"], string>();
  for (const messageId of new Set(quoted.map((change) => change.messageId))) {
    const trace = await deps.findTraceQuotes(messageId);
    if (!trace.success || !trace.data) continue;
    for (const change of quoted.filter((candidate) => candidate.messageId === messageId)) {
      const quote = trace.data.find((candidate) => candidate.id === change.quoteId);
      if (quote) quotes.set(change.id, quote.text);
    }
  }
  return quotes;
}
