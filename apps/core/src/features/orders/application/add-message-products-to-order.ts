import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { buildPendingOrder, orderStateMachine, type OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import { isOpenForMessageItems, selectProductCode, type ChatId, type MessageOrderSkipReason, type VariantQrCode } from "@core/src/features/orders/domain/message-order";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { CompanyId, ContactId, OrderId, OrderItemId, UserId } from "@core/src/features/orders/domain/order";
import type { CatalogItem } from "@core/src/features/orders/application/order-snapshots";
import type { ReadQrCodes } from "@core/src/features/orders/infrastructure/qr-code-reader";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { CustomerId } from "@core/src/features/contacts/domain/contact";
import type { ImageId, VariantId } from "@core/src/features/products/domain/product";
import type { ImageReadError } from "@core/src/shared/images";

export type OrderSourceMessage = Readonly<{
  id: ChatMessageId;
  companyId: CompanyId;
  chatId: ChatId;
  contactId: ContactId;
  direction: "incoming" | "outgoing";
  uploadedByUserId: UserId;
  imageId: ImageId | null; // null en mensajes de texto
}>;

export type MessageCustomer = Readonly<{
  customerId: CustomerId;
  contactId: ContactId;
}>;

export type AddMessageProductsOutcome =
  | Readonly<{ kind: "order_created"; orderId: OrderId; variantIds: readonly VariantId[]; unknownCodes: readonly VariantQrCode[] }>
  | Readonly<{ kind: "items_added"; orderId: OrderId; variantIds: readonly VariantId[]; unknownCodes: readonly VariantQrCode[] }>
  | Readonly<{ kind: "already_processed"; orderId: OrderId }>
  | Readonly<{ kind: "skipped"; reason: MessageOrderSkipReason }>;

export type AddMessageProductsError = Readonly<{
  code:
    | "PERSISTENCE_UNAVAILABLE"
    | "IMAGE_STORAGE_UNAVAILABLE"
    | "QR_READER_UNAVAILABLE"
    | "MESSAGE_NOT_FOUND"
    | "IMAGE_NOT_FOUND"
    | "CONTACT_NOT_FOUND"
    | "SELLER_UNAVAILABLE"
    | "CURRENCY_MISMATCH"
    | "INVALID_ORDER";
  message: string;
}>;

type PersistenceError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;
type ContactNotFound = Readonly<{ code: "CONTACT_NOT_FOUND"; message: string }>;
type InvalidStoredOrder = Readonly<{ code: "INVALID_ORDER"; message: string }>;
type SellerUnavailable = Readonly<{ code: "SELLER_UNAVAILABLE"; message: string }>;
type MessageAlreadyProcessed = Readonly<{ code: "MESSAGE_ALREADY_PROCESSED"; message: string }>;

export type OrderChatSource = Readonly<{ chatId: ChatId; customerId: CustomerId }>;

export type AddMessageProductsDependencies = Readonly<{
  findSourceMessage: (id: ChatMessageId) => Promise<Result<OrderSourceMessage | null, PersistenceError>>;
  readImage: (imageId: ImageId) => Promise<Result<Readonly<{ bytes: Uint8Array; contentType: string }>, ImageReadError>>;
  readQrCodes: ReadQrCodes;
  findVariantsByCodes: (codes: readonly VariantQrCode[]) => Promise<Result<readonly (CatalogItem & { qrCode: VariantQrCode })[], PersistenceError>>;
  findProcessedMessage: (messageId: ChatMessageId) => Promise<Result<OrderId | null, PersistenceError>>;
  transaction: <T>(
    companyId: CompanyId,
    work: () => Promise<Result<T, AddMessageProductsError | MessageAlreadyProcessed>>,
  ) => Promise<Result<T, AddMessageProductsError | MessageAlreadyProcessed>>;
  // Las siguientes requieren transacción activa.
  ensureCustomerForContact: (contactId: ContactId) => Promise<Result<MessageCustomer, PersistenceError | ContactNotFound>>;
  findOpenChatOrderCandidate: (chatId: ChatId) => Promise<Result<OrderId | null, PersistenceError>>;
  findOrderForUpdate: (orderId: OrderId) => Promise<Result<OrderAggregate | null, PersistenceError | InvalidStoredOrder>>;
  allocateNumber: (companyId: CompanyId) => Promise<Result<OrderNumber, PersistenceError>>;
  // Desviación: la FK del vendedor es la única señal de SELLER_UNAVAILABLE (§6), así que el puerto puede devolverla.
  saveNewOrder: (order: OrderAggregate, source: OrderChatSource) => Promise<Result<null, PersistenceError | SellerUnavailable>>;
  saveAddedItems: (order: OrderAggregate, previous: OrderAggregate) => Promise<Result<null, PersistenceError>>;
  recordProcessedMessage: (orderId: OrderId, messageId: ChatMessageId) => Promise<Result<null, PersistenceError | MessageAlreadyProcessed>>;
  newOrderId: () => OrderId;
  newItemId: () => OrderItemId;
  clock: () => Date;
}>;

type Input = Readonly<{ companyId: CompanyId; messageId: ChatMessageId }>;
type Scan = Readonly<{ variants: readonly (CatalogItem & { qrCode: VariantQrCode })[]; unknownCodes: readonly VariantQrCode[] }>;
type TransactionOutcome = Extract<AddMessageProductsOutcome, { kind: "order_created" | "items_added" | "already_processed" }>;

const skipped = (reason: MessageOrderSkipReason) => ok<AddMessageProductsOutcome>({ kind: "skipped", reason });

export async function addMessageProductsToOrder(input: Input, deps: AddMessageProductsDependencies): Promise<Result<AddMessageProductsOutcome, AddMessageProductsError>> {
  const processed = await deps.findProcessedMessage(input.messageId);
  if (!processed.success) return processed;
  if (processed.data) return ok({ kind: "already_processed", orderId: processed.data });
  const found = await deps.findSourceMessage(input.messageId);
  if (!found.success) return found;
  const message = found.data;
  if (!message || message.companyId !== input.companyId) return err({ code: "MESSAGE_NOT_FOUND", message: "Message is not available" });
  if (!message.imageId) return skipped("not_image");
  if (message.direction === "outgoing") return skipped("outgoing_message");
  const scan = await scanMessage(message.imageId, deps);
  if (!scan.success) return scan;
  const products = scan.data;
  if ("reason" in products) return skipped(products.reason);
  const entered = await deps.transaction(input.companyId, () => addInTransaction(input, message, products, deps));
  if (entered.success) return entered;
  if (entered.error.code !== "MESSAGE_ALREADY_PROCESSED") return err(entered.error);
  // La transacción se revirtió; el ganador ya registró el mensaje.
  const winner = await deps.findProcessedMessage(input.messageId);
  if (!winner.success) return winner;
  return winner.data ? ok({ kind: "already_processed", orderId: winner.data })
    : err({ code: "PERSISTENCE_UNAVAILABLE", message: "Processed message is not visible" });
}

async function scanMessage(imageId: ImageId, deps: AddMessageProductsDependencies): Promise<Result<Scan | Readonly<{ reason: MessageOrderSkipReason }>, AddMessageProductsError>> {
  const image = await deps.readImage(imageId);
  if (!image.success) return image;
  const decoded = await deps.readQrCodes(image.data);
  // Una imagen ilegible se omite: reintentar no cambia el resultado.
  if (!decoded.success) return decoded.error.code === "QR_READER_UNAVAILABLE" ? err({ code: decoded.error.code, message: decoded.error.message }) : ok({ reason: "unreadable_image" });
  const selection = selectProductCode(decoded.data);
  if (selection.kind === "skip") return ok({ reason: selection.reason });
  const variants = await deps.findVariantsByCodes(selection.codes);
  if (!variants.success) return variants;
  if (!variants.data.length) return ok({ reason: "product_not_found" });
  const known = new Set<string>(variants.data.map((variant) => variant.qrCode));
  return ok({ variants: variants.data, unknownCodes: selection.codes.filter((code) => !known.has(code)) });
}

async function addInTransaction(input: Input, message: OrderSourceMessage, scan: Scan, deps: AddMessageProductsDependencies): Promise<Result<TransactionOutcome, AddMessageProductsError | MessageAlreadyProcessed>> {
  const customer = await deps.ensureCustomerForContact(message.contactId);
  if (!customer.success) return customer;
  const again = await deps.findProcessedMessage(message.id);
  if (!again.success) return again;
  if (again.data) return ok({ kind: "already_processed", orderId: again.data });
  const written = await writeItems(input, message, customer.data, scan, deps);
  if (!written.success) return written;
  const recorded = await deps.recordProcessedMessage(written.data.orderId, message.id);
  if (!recorded.success) return recorded; // MESSAGE_ALREADY_PROCESSED revierte y se resuelve fuera
  return written;
}

async function writeItems(input: Input, message: OrderSourceMessage, customer: MessageCustomer, scan: Scan,
  deps: AddMessageProductsDependencies): Promise<Result<Extract<TransactionOutcome, { kind: "order_created" | "items_added" }>, AddMessageProductsError>> {
  const variantIds = scan.variants.map((variant) => variant.variantId);
  const candidate = await deps.findOpenChatOrderCandidate(message.chatId);
  if (!candidate.success) return candidate;
  if (candidate.data) {
    const locked = await deps.findOrderForUpdate(candidate.data);
    if (!locked.success) return locked;
    if (locked.data && isOpenForMessageItems(locked.data, message.chatId)) {
      const next = orderStateMachine.appendItems(locked.data, scan.variants, deps.newItemId);
      if (!next.success) return next;
      const saved = await deps.saveAddedItems(next.data, locked.data);
      return saved.success ? ok({ kind: "items_added", orderId: locked.data.id, variantIds, unknownCodes: scan.unknownCodes }) : saved;
    }
  }
  const number = await deps.allocateNumber(input.companyId);
  if (!number.success) return number;
  const built = buildPendingOrder({ number: number.data, id: deps.newOrderId(), companyId: input.companyId, sellerId: message.uploadedByUserId,
    customer: { kind: "contact", contactId: customer.contactId, name: null, phone: null }, createdAt: deps.clock(),
    items: scan.variants.map((variant) => ({ id: deps.newItemId(), variantId: variant.variantId, productName: variant.productName,
      variantAttributes: variant.variantAttributes, sku: variant.sku, unitPrice: variant.unitPrice, quantity: 1 })) });
  if (!built.success) return built;
  const saved = await deps.saveNewOrder(built.data, { chatId: message.chatId, customerId: customer.customerId });
  return saved.success ? ok({ kind: "order_created", orderId: built.data.id, variantIds, unknownCodes: scan.unknownCodes }) : saved;
}
