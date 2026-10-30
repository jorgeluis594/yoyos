import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { prisma, withinTransaction, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { createVisualSearch, products, type ImageEmbedder } from "@core/src/features/products/composition";
import { identifyProductsInImage, type IdentifyProductsDependencies, type ImageIdentification } from "@core/src/features/products/application/identify-products-in-image";
import { catalogSearchReadiness } from "@core/src/features/products/application/catalog-search-readiness";
import { hasActiveProducts } from "@core/src/features/products/infrastructure/catalog-search-readiness";
import { hasIndexedProducts } from "@core/src/features/products/infrastructure/image-embeddings";
import { readQrCodes } from "@core/src/shared/images/infrastructure/qr-code-reader";
import { findSellableVariantsByQrCodes } from "@core/src/features/products/infrastructure/order-stock";
import { findProductIdsOfVariants } from "@core/src/features/products";
import type { ImageId, ProductId, VariantId } from "@core/src/features/products/domain/product";
import { setVariantStatus } from "@core/src/features/products/infrastructure/variant-repository";
import { saveCheckoutBuyer, saveCheckoutConfirmed } from "@core/src/features/orders/infrastructure/checkout-repository";
import { cancelOrder } from "@core/src/features/orders/application/cancel-order";
import { reportPayment } from "@core/src/features/orders/application/report-payment";
import { registerPayment } from "@core/src/features/orders/application/register-payment";
import { voidPayment } from "@core/src/features/orders/application/void-payment";
import type { ImageId as PaymentImageId } from "@core/src/features/orders/domain/payment";
import { findVariantStock } from "@core/src/features/products";
import { publishStockEvent } from "@core/src/features/orders/composition";
import { minShowsProduct, type ImageBytes, type MatchConfidence, type VariantQrCode } from "@core/src/features/products/domain/image-identification";
import { applyChatMessage, isRetryableChatMessageError, type ApplyChatMessageDependencies, type ApplyChatMessageOutcome, type ApplyChatMessageError } from "@core/src/features/orders/application/apply-chat-message";
import { chatMessageDeadlineMs } from "@core/src/features/orders/application/chat-message-policy";
import { allocateOrderNumber, findChatOrderTarget, findChatOrderTargetForUpdate, findChatOrdersOpenedSince, findOrderAggregate, findOrderForUpdate, recordProcessedMessage, saveCancellation, saveCompletion, saveItemChanges, savePayment, savePendingOrder, updatePayment } from "@core/src/features/orders/infrastructure/order-repository";
import { findOutcome, recordOutcome } from "@core/src/features/orders/infrastructure/chat-message-outcome-repository";
import type { ChatId } from "@core/src/features/orders/domain/message-order";
import { findChatPendings, findChatPendingsForUpdate, saveChatPendings } from "@core/src/features/orders/infrastructure/chat-pending-repository";
import { createFitReadingContext, readerTokenBudget } from "@core/src/features/orders/infrastructure/chat-reader-budget";
import { readChatReaderEnv } from "@core/src/features/orders/infrastructure/chat-reader-env";
import { createChatReaderFromEnv } from "@core/src/features/orders/infrastructure/chat-reader-from-env";
import { readChatMessageLimits } from "@core/src/features/orders/infrastructure/chat-message-limits-env";
import type { ChatPending, ChatPendingId } from "@core/src/features/orders/domain/chat-pendings";
import type { CompanyId, ContactId, OrderId, OrderItemId, PaymentId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import { ensureCustomerForContact, lockContact } from "@core/src/features/contacts";
import { findOrderSourceMessage } from "@core/src/features/chats";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { CustomerId } from "@core/src/features/contacts/domain/contact";
import { metered, type ModelCall } from "@core/evals/lib/model-meter";
import { catalogOf, describeVariantId, findVariant, productById, productIdOf, variantIdOf, type CatalogScope, type ProductKey } from "@core/evals/fixtures/catalog";
import type { EventStep, MessageInput, MessageStep, OrderLine, PendingSeed } from "@core/evals/cases/schema";
import { evalCompanyId, privateCompanyId, readRegisteredImage, registerImageFile, scopeOfCompany, sellerOfCompany } from "@core/evals/lib/eval-catalog";
import { SimulatedClock, runConversationSteps, type StepResult } from "@core/evals/lib/conversation";

/**
 * The production code path of message-to-order, wired as `orders/composition.ts` and `products/composition.ts` wire it, against the
 * test database. Faked: image storage (fixture files) and, in the interpretation pass only, the photo identification. Nothing publishes
 * events, so no notice reaches WhatsApp or push. Model answers are observed by wrapping the model ports, never changed.
 */

/**
 * A model certainty and the production gate it is compared with. Only the visual search has a gate on reading a message (technical
 * design §2): `visual_none` is the vision chooser's «none», reported apart, and `shows_product` its probability that the photo shows a
 * product, at its 0.5 gate, with «product» or «not_product» as pick.
 */
export type CertaintySource = "visual" | "visual_none" | "shows_product";
/** `pick` is the model's own answer, independent of what the gate then decided: the product key chosen for a photo (null for «none»). */
export type Certainty = Readonly<{ source: CertaintySource; confidence: number; gate: number; pick?: string | null; detail?: string }>;

/** What the models decided while one case ran: the visual certainties and, when diagnostics are on, the reader's raw answers (one per call). */
export type Observation = { certainties: Certainty[]; readerAnswers: unknown[] };

const newObservation = (): Observation => ({ certainties: [], readerAnswers: [] });
const observed = new AsyncLocalStorage<Observation>();
const current = () => observed.getStore();
const observe = (certainty: Certainty) => current()?.certainties.push(certainty);
const observeReaderAnswer = (answer: unknown) => current()?.readerAnswers.push(answer);

/** Runs `work` and returns what the models decided during it. */
export async function observing<T>(work: () => Promise<T>): Promise<Readonly<{ value: T; observation: Observation }>> {
  const observation = newObservation();
  const value = await observed.run(observation, work);
  return { value, observation };
}

/** Forgets what an earlier attempt observed, so a retried message reports only the scored attempt. */
function resetObservation(): void {
  const observation = current();
  if (observation) Object.assign(observation, newObservation());
}

/** The company a case runs in: the committed eval company, or the private one of an `EVAL_PRIVATE_DIR` run. */
export type EvalCompany = Readonly<{ companyId: string; sellerId: string; scope: CatalogScope }>;
export const companyOf = (scope: CatalogScope): EvalCompany => {
  const companyId = scope === "private" ? privateCompanyId : evalCompanyId;
  return { companyId, sellerId: sellerOfCompany(companyId), scope: scopeOfCompany(companyId) };
};

const inTenant = <T>(company: EvalCompany, work: () => PromiseLike<T>): Promise<T> => withTenantIsolation(company.companyId, async () => await work());

type Env = Readonly<Record<string, string | undefined>>;

export type ProductionPath = ReturnType<typeof createProductionPath>;

/** Builds the real clients from the env once per suite; throws when the providers are not configured. */
export function createProductionPath(env: Env, options: Readonly<{ diagnostics?: boolean }> = {}) {
  // The reader's raw answers are observed only when diagnostics are on (dev split, not private): the production reader is otherwise untouched.
  const readChatMessage = createChatReaderFromEnv(env, options.diagnostics ? { observe: observeReaderAnswer } : {});
  const visualSetup = createVisualSearch(env);
  if (!readChatMessage || !visualSetup.visual || !visualSetup.embedder) throw new Error("The production path needs OPENAI_API_KEY");
  const visual = { ...visualSetup.visual, readImage: readRegisteredImage, chooseProduct: async (input: Parameters<NonNullable<typeof visualSetup.visual>["chooseProduct"]>[0], signal?: AbortSignal) => {
    const choice = await visualSetup.visual!.chooseProduct(input, signal);
    // Every answer is recorded: the product or «none» (gated at the match confidence) and whether the photo shows a product (at 0.5).
    if (choice.success) {
      const product = choice.data.kind === "product" ? productById(choice.data.productId)?.key ?? choice.data.productId : null;
      observe({ source: product === null ? "visual_none" : "visual", confidence: choice.data.confidence, gate: visualSetup.visual!.minConfidence,
        pick: product, detail: product ?? "none" });
      const shows = choice.data.showsProduct >= minShowsProduct ? "product" : "not_product";
      observe({ source: "shows_product", confidence: choice.data.showsProduct, gate: minShowsProduct, pick: shows, detail: shows });
    }
    return choice;
  } };
  const imageIdentification: IdentifyProductsDependencies = {
    readQrCodes,
    findVariantsByCodes: async (codes) => {
      const found = await findSellableVariantsByQrCodes(codes);
      return found.success ? ok(found.data.map((item) => ({ ...item, qrCode: item.qrCode as VariantQrCode, productId: item.productId as ProductId }))) : found;
    },
    visual,
  };
  const readiness = { visualModel: visual.model, hasActiveProducts, hasIndexedProducts };
  const limits = readChatMessageLimits(env);
  // The same budget production derives: the reader model's prices and the photo stages' reserve at the configured bounds.
  const fitToBudget = createFitReadingContext({ budget: readerTokenBudget({ photoStagesReserveUsd: visualSetup.photoStagesReserveUsd, model: readChatReaderEnv(env).AI_READER_MODEL }) });
  const fitReadingContext: ApplyChatMessageDependencies["fitReadingContext"] = (context) => { const fitted = fitToBudget(context); return "code" in fitted ? err(fitted) : ok(fitted); };
  const wiring: Wiring = { readChatMessage, readiness, imageIdentification, limits, fitReadingContext, photoStageTimeoutMs: visualSetup.photoStageTimeoutMs };

  return {
    /** The production gate of the visual search. */
    gates: { visual: visualSetup.visual.minConfidence },
    embedder: visualSetup.embedder as ImageEmbedder,
    identifyImage: (image: ImageBytes) => inTenant(companyOf("eval"), () => identifyProductsInImage(image, imageIdentification)),
    /** Applies one message through apply-chat-message, seeding the open order first; `photos` says how the photo is identified. */
    applyMessage: (input: MessageInput, photos: "fixed" | "real", scope: CatalogScope = "eval") => applyMessage(input, photos, wiring, companyOf(scope)),
    /** Applies a conversation: one chat, its messages and events in order on one simulated clock. */
    applyConversation: (steps: readonly ConversationStepInput[], scope: CatalogScope = "eval", start: ChatStart = noStart) => applyConversation(steps, wiring, companyOf(scope), start),
  };
}

/** The state a chat starts in (cases/schema.ts `startState`): applied before the first message or step. */
export type ChatStart = Readonly<{ order: readonly OrderLine[]; pendings: readonly PendingSeed[]; orderState?: "closed" }>;
const noStart: ChatStart = { order: [], pendings: [] };

type ConversationStepInput = Parameters<typeof runConversationSteps>[0][number];

type Wiring = Readonly<{
  readChatMessage: NonNullable<ApplyChatMessageDependencies["readChatMessage"]>;
  readiness: Parameters<typeof catalogSearchReadiness>[0];
  imageIdentification: IdentifyProductsDependencies;
  limits: ApplyChatMessageDependencies["limits"];
  fitReadingContext: ApplyChatMessageDependencies["fitReadingContext"];
  photoStageTimeoutMs: number;
}>;

/** What seeding a start needs of the wiring: label photos pass through `applyChatMessage` with no reader, so no model is called. */
type SeedWiring = Pick<Wiring, "readChatMessage" | "readiness" | "limits" | "fitReadingContext" | "photoStageTimeoutMs">;

type Persistence = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;

function dependencies(wiring: SeedWiring, identify: ApplyChatMessageDependencies["identifyProductsInImage"], company: EvalCompany, clock: () => Date): ApplyChatMessageDependencies {
  // The private company has no indexed photos: its catalog counts as searchable once it has active products.
  const readiness = company.scope === "private" ? { ...wiring.readiness, hasIndexedProducts: async () => ok(true) } : wiring.readiness;
  return {
    findOutcome,
    findSourceMessage: async (id) => {
      const found = await findOrderSourceMessage(id);
      if (!found.success || !found.data) return found as Result<null, Persistence>;
      const message = found.data;
      return ok({ ...message, companyId: message.companyId as string as CompanyId, chatId: message.chatId as ChatId,
        contactId: message.contactId as ContactId, uploadedByUserId: message.uploadedByUserId as string as UserId, imageId: message.imageId as ImageId | null });
    },
    findChatOrderTarget: (chatId) => findChatOrderTarget(chatId, findProductIdsOfVariants),
    findChatOrdersOpenedSince,
    findChatPendings,
    findChatPendingsForUpdate,
    saveChatPendings,
    readImage: (imageId) => readRegisteredImage(imageId),
    identifyProductsInImage: identify,
    findProductsForReading: (productIds) => products.findProductsForReading(productIds),
    findMessageCandidates: (text) => products.findMessageCandidates(text),
    catalogSearchReadiness: () => catalogSearchReadiness(readiness),
    readChatMessage: wiring.readChatMessage,
    transaction: (_companyId, work) => withinTransaction(work),
    lockContact,
    ensureCustomerForContact: async (contactId) => {
      const ensured = await ensureCustomerForContact(contactId);
      return ensured.success ? ok({ customerId: ensured.data.customerId as CustomerId }) : ensured;
    },
    findChatOrderTargetForUpdate: (chatId) => findChatOrderTargetForUpdate(chatId, findProductIdsOfVariants),
    allocateNumber: () => allocateOrderNumber(company.companyId as CompanyId),
    saveNewOrder: (order, link) => savePendingOrder(order, link),
    saveItemChanges,
    recordOrderMessage: recordProcessedMessage,
    recordOutcome,
    newOrderId: () => randomUUID() as OrderId,
    newItemId: () => randomUUID() as OrderItemId,
    newPendingId: () => randomUUID() as ChatPendingId,
    clock,
    limits: wiring.limits,
    fitReadingContext: wiring.fitReadingContext,
    photoStageTimeoutMs: wiring.photoStageTimeoutMs,
  };
}

type Chat = Readonly<{ chatId: string; contactId: string }>;

async function newChat(company: EvalCompany): Promise<Chat> {
  const contactId = randomUUID();
  const chatId = randomUUID();
  await inTenant(company, async () => {
    await prisma.contact.create({ data: { id: contactId, whatsappAccountId: `${contactId}@lid`, whatsappLid: `${contactId}@lid` } });
    await prisma.chat.create({ data: { id: chatId, contactId } });
  });
  return { chatId, contactId };
}

async function newMessage(chat: Chat, content: Readonly<{ text?: string; caption?: string; imageFile?: string; image?: boolean }>, company: EvalCompany, at: Date): Promise<ChatMessageId> {
  const messageId = randomUUID() as ChatMessageId;
  const imageId = content.imageFile || content.image ? randomUUID() : null;
  // A photo identified by hand still needs readable bytes: the use case reads the image before identifying it. Any repository CC0 photo will do.
  if (imageId) registerImageFile(imageId, content.imageFile ?? "src/features/products/infrastructure/product-matching/embedding-fixtures/product-a-front.jpg");
  await inTenant(company, async () => {
    if (imageId) await prisma.image.create({ data: { id: imageId, storageKey: `evals/messages/${imageId}` } });
    await prisma.chatMessage.create({ data: { id: messageId, chatId: chat.chatId, externalId: `ext-${messageId}`, whatsappMessageId: `wa-${messageId}`,
      direction: "incoming", source: "contact", type: imageId ? "image" : "text", imageId, text: content.text ?? null, caption: content.caption ?? null,
      uploadedByUserId: company.sellerId, sentAt: at, receivedAt: at } });
  });
  return messageId;
}

/** A product label photo identified by its QR code, as the cascade reports it. */
async function labelIdentification(product: ProductKey, variant: Readonly<Record<string, string>>, company: EvalCompany): Promise<ImageIdentification> {
  // The variant's own attribute order makes its id, whatever order the case wrote.
  const code = variantIdOf(product, findVariant(product, variant, company.scope).attributes, company.scope);
  const found = await inTenant(company, () => findSellableVariantsByQrCodes([code]));
  if (!found.success || !found.data.length) throw new Error(`Seeded variant ${code} is missing`);
  return { kind: "found", method: "qr", items: found.data.map((item) => ({ ...item, productId: item.productId as ProductId })), unknownCodes: [] };
}

const fixed = (identification: ImageIdentification): ApplyChatMessageDependencies["identifyProductsInImage"] => async () => ok(identification);

/** Writes the status of every variant of a product, or of the one with `attributes`, as the deactivate-product use case does. */
async function setProductStatus(product: ProductKey, attributes: Readonly<Record<string, string>> | null, status: "active" | "inactive", company: EvalCompany): Promise<void> {
  const variants = productById(productIdOf(product, company.scope))?.variants ?? [];
  for (const variant of variants.filter((candidate) => attributes === null || candidate === findVariant(product, attributes, company.scope))) {
    const variantId = variantIdOf(product, variant.attributes, company.scope) as VariantId;
    const changed = await inTenant(company, () => setVariantStatus(variantId, status, { productId: productIdOf(product, company.scope) as ProductId, variantId, action: "change_status", started: performance.now() }));
    if (!changed.success) throw new Error(`Setting ${product} ${status} failed: ${changed.error.code}`);
  }
}

/** Reactivating is company-wide and transient; it is safe because evals run one case at a time (`maxWorkers: 1`, `fileParallelism: false`).
 * The lines whose product or variant the catalog marks inactive: the order is seeded while they are active, then they go back to inactive. */
const inactiveLines = (lines: readonly OrderLine[], company: EvalCompany) => lines.filter((line) =>
  !catalogOf(company.scope).products.find(({ key }) => key === line.product)?.active || !findVariant(line.product, line.variant, company.scope).active);

/** Seeds the open order with label photos (QR, no caption): the deterministic path, no model call. */
async function seedOrder(chat: Chat, lines: readonly OrderLine[], wiring: SeedWiring, company: EvalCompany): Promise<void> {
  const inactive = inactiveLines(lines, company);
  for (const line of inactive) await setProductStatus(line.product, line.variant, "active", company);
  try {
    await addOrderLines(chat, lines, wiring, company);
  } finally {
    for (const line of inactive) await setProductStatus(line.product, line.variant, "inactive", company);
  }
}

async function addOrderLines(chat: Chat, lines: readonly OrderLine[], wiring: SeedWiring, company: EvalCompany): Promise<void> {
  for (const line of lines) {
    const identified = await labelIdentification(line.product, line.variant, company);
    for (let unit = 0; unit < line.quantity; unit += 1) {
      const messageId = await newMessage(chat, { image: true }, company, new Date());
      const applied = await inTenant(company, () => applyChatMessage({ companyId: company.companyId as CompanyId, messageId },
        dependencies(wiring, fixed(identified), company, () => new Date()), AbortSignal.timeout(chatMessageDeadlineMs)));
      if (!applied.success || applied.data.kind !== "applied" || applied.data.outcomes[0].kind !== "added") throw new Error(`Seeding ${line.product} failed: ${JSON.stringify(applied)}`);
    }
  }
}

/** Saves the pendings through the repository, attached to the chat's order when it has one (a pending created while the order was open). */
async function seedPendings(chat: Chat, pendings: readonly PendingSeed[], company: EvalCompany): Promise<void> {
  if (!pendings.length) return;
  const order = await orderOfChat(chat.chatId, company);
  const now = new Date();
  const productId = (product: ProductKey) => productIdOf(product, company.scope) as ProductId;
  const seeded = pendings.map((pending): ChatPending => {
    const id = randomUUID() as ChatPendingId;
    return {
      id,
      subject: "product" in pending ? { kind: "variant", productId: productId(pending.product) }
        : { kind: "product", candidates: pending.candidates.map(productId) as [ProductId, ProductId, ...ProductId[]] },
      known: pending.known, quantity: pending.quantity as PositiveInteger, price: null,
      order: order ? { orderId: order.id as OrderId, attachedAt: now } : null,
      lastChangedAt: now, sourceMessageId: randomUUID() as ChatMessageId, requestId: id,
    };
  });
  const saved = await inTenant(company, () => withinTransaction(() => saveChatPendings(chat.chatId as ChatId, { pendings: seeded, readyRemembered: false, lastIncomingPhoto: null })));
  if (!saved.success) throw new Error(`Seeding the pendings failed: ${saved.error.code}`);
}

/**
 * Seeds the chat's start: the order lines, then the pendings, then the closing. `closed` is the order paid in full by hand, the same
 * path as the `confirm_payment` event without a report, so the chat's target is a closed order. Returns the payment it made.
 */
async function seedStart(chat: Chat, start: ChatStart, wiring: SeedWiring, company: EvalCompany, clock: () => Date = () => new Date()): Promise<PaymentState> {
  await seedOrder(chat, start.order, wiring, company);
  await seedPendings(chat, start.pendings, company);
  return start.orderState === "closed" ? applyEvent({ event: "confirm_payment" }, chat, company, clock, null) : null;
}

export type AppliedLine = Readonly<{ product: ProductKey | null; variant: Readonly<Record<string, string>>; quantity: number; unitPrice: number;
  mentionedPrice: Readonly<{ amount: number; units: number }> | null }>;

export type AppliedMessage = Readonly<{
  result: Result<ApplyChatMessageOutcome, ApplyChatMessageError>;
  /** The chat's latest order after the message, or null when the chat has none. */
  order: readonly AppliedLine[] | null;
  attempts: number;
  /** Duration of the scored (last) applyChatMessage attempt: no chat creation, order seeding or earlier attempts. */
  latencyMs: number;
}>;

async function chatOrderLines(chatId: string, company: EvalCompany): Promise<readonly AppliedLine[] | null> {
  const order = await inTenant(company, () => prisma.order.findFirst({ where: { chatId }, include: { items: true }, orderBy: { number: "desc" } }));
  if (!order) return null;
  return order.items.map((item) => ({
    product: describeVariantId(item.variantId)?.product ?? null,
    variant: item.variantAttributes as Record<string, string>,
    quantity: Number(item.quantity),
    unitPrice: Number(item.unitPrice),
    mentionedPrice: item.mentionedPriceAmount === null ? null : { amount: Number(item.mentionedPriceAmount), units: item.mentionedPriceUnits ?? 1 },
  }));
}

/** How the photo of a case is identified: by hand in the interpretation pass, by the real cascade end to end. */
async function photoIdentification(photo: NonNullable<MessageInput["photo"]>, wiring: Wiring, company: EvalCompany): Promise<ApplyChatMessageDependencies["identifyProductsInImage"]> {
  if ("file" in photo) return (image, signal) => identifyProductsInImage(image, wiring.imageIdentification, signal);
  if (photo.shows === "not_product") return fixed({ kind: "not_product" });
  if (photo.shows === "not_found") return fixed({ kind: "not_found", reason: "no_visual_match" });
  if ("label" in photo && photo.label) return fixed(await labelIdentification(photo.shows, photo.label, company));
  return fixed({ kind: "found", method: "visual", productId: productIdOf(photo.shows, company.scope) as ProductId, confidence: 0.95 as MatchConfidence, candidates: 1, topDistance: 0 });
}

const maxAttempts = 3;

/** Applies the message `messageId` as the queue would: retryable failures are retried, each attempt repeating every paid stage. */
async function applyStored(messageId: ChatMessageId, chatId: string, identify: ApplyChatMessageDependencies["identifyProductsInImage"], wiring: Wiring,
  company: EvalCompany, clock: () => Date): Promise<AppliedMessage> {
  let attempts = 0;
  let latencyMs: number;
  let result: AppliedMessage["result"];
  do {
    attempts += 1;
    resetObservation();
    const started = performance.now();
    result = await inTenant(company, () => applyChatMessage({ companyId: company.companyId as CompanyId, messageId }, dependencies(wiring, identify, company, clock),
      AbortSignal.timeout(chatMessageDeadlineMs)));
    latencyMs = Math.round(performance.now() - started);
  } while (!result.success && isRetryableChatMessageError(result.error) && attempts < maxAttempts);
  return { result, order: await chatOrderLines(chatId, company), attempts, latencyMs };
}

async function applyMessage(input: MessageInput, photos: "fixed" | "real", wiring: Wiring, company: EvalCompany): Promise<AppliedMessage> {
  const chat = await newChat(company);
  await seedStart(chat, input, wiring, company);
  if (photos === "fixed" && input.photo && "file" in input.photo) throw new Error("The interpretation pass identifies photos by hand");
  const identify = input.photo ? await photoIdentification(input.photo, wiring, company) : fixed({ kind: "not_product" });
  const messageId = await newMessage(chat, input.photo
    ? { caption: input.caption, ...("file" in input.photo ? { imageFile: input.photo.file } : { image: true }) }
    : { text: input.text }, company, new Date());
  return applyStored(messageId, chat.chatId, identify, wiring, company, () => new Date());
}

/** One message of a conversation: the order before it (the real result of the earlier messages), the message's result and what its model calls were. */
export type ConversationMessage = Readonly<{ applied: AppliedMessage; previousOrder: readonly AppliedLine[]; observation: Observation; calls: readonly ModelCall[] }>;

/** The messages a conversation applied, in order, and the error that stopped it, if any. */
export type AppliedConversation = Readonly<{ results: readonly StepResult<ConversationMessage>[]; error: Error | null }>;

/**
 * Applies the steps of a conversation to one chat. Messages and events share the simulated clock: the messages' `sentAt` and the
 * `clock` of `applyChatMessage` and of the payment, cancellation and product use cases all read it. Photos are identified by the
 * case (`shows`), as in the interpretation pass; earlier messages are applied for real, not seeded.
 */
async function applyConversation(steps: readonly ConversationStepInput[], wiring: Wiring, company: EvalCompany, start: ChatStart): Promise<AppliedConversation> {
  const chat = await newChat(company);
  let payment: PaymentState = await seedStart(chat, start, wiring, company);
  let previousOrder: readonly AppliedLine[] = await chatOrderLines(chat.chatId, company) ?? [];
  const driver = {
    message: async (step: MessageStep, _number: number, clock: SimulatedClock): Promise<ConversationMessage> => {
      const { input } = step;
      if (input.photo && "file" in input.photo) throw new Error("A conversation identifies photos by hand");
      const identify = input.photo ? await photoIdentification(input.photo, wiring, company) : fixed({ kind: "not_product" });
      const messageId = await newMessage(chat, input.photo ? { caption: input.caption, image: true } : { text: input.text }, company, clock.now());
      const before = previousOrder;
      // Each message is metered apart, so its record keeps its own model calls.
      const { value: measured, calls } = await metered("system", () => observing(() => applyStored(messageId, chat.chatId, identify, wiring, company, clock.now)));
      previousOrder = measured.value.order ?? before;
      return { applied: measured.value, previousOrder: before, observation: measured.observation, calls };
    },
    event: async (step: EventStep, clock: SimulatedClock) => {
      payment = await applyEvent(step, chat, company, clock.now, payment);
    },
  };
  // A step that throws stops the conversation; the messages it applied before stay, so the runner can record them.
  const done: StepResult<ConversationMessage>[] = [];
  const collecting = { ...driver, message: async (...args: Parameters<typeof driver.message>) => {
    const result = await driver.message(...args);
    done.push({ step: args[0], number: args[1], at: args[2].now(), result });
    return result;
  } };
  try {
    await runConversationSteps(steps, collecting);
    return { results: done, error: null };
  } catch (cause) {
    return { results: done, error: cause instanceof Error ? cause : new Error(String(cause)) };
  }
}

const orderOfChat = (chatId: string, company: EvalCompany) => inTenant(company, () => prisma.order.findFirst({ where: { chatId }, orderBy: { number: "desc" }, select: { id: true } }));

/** The conversation's latest payment: reported by the buyer, or confirmed (by the seller, with or without a report). */
type PaymentState = Readonly<{ id: string; status: "reported" | "confirmed" }> | null;

/**
 * Runs an event through the production use cases at the simulated time. Nothing publishes events here, so a cancellation does not
 * restore stock. Returns the conversation's payment after the event.
 * - `report_payment` is the buyer's flow: it first confirms the checkout (a report requires it), which ends the order's time open for
 *   messages for good.
 * - `confirm_payment` confirms the reported payment, or, with none, registers a payment the seller received by hand (no checkout).
 *   With `partial` the payment is half the total: the order is not paid and no stock is deducted, so a `void_payment` reopens it for
 *   messages (a paid order, or one with stock deducted, never reopens).
 * - `void_payment` voids the confirmed payment; after a report alone, it confirms it first, at the same time.
 * - `deactivate_product` writes the variants' status as the use case does, without the product detail reload, which needs image storage.
 */
async function applyEvent(step: EventStep, chat: Chat, company: EvalCompany, clock: () => Date, payment: PaymentState): Promise<PaymentState> {
  const access = { companyId: company.companyId as CompanyId, userId: company.sellerId as UserId };
  const transaction = <T, E extends { code: string; message: string }>(_companyId: string, work: () => Promise<Result<T, E>>) => withinTransaction(work);
  if (step.event === "deactivate_product") {
    await setProductStatus(step.product, null, "inactive", company);
    return payment;
  }
  if (step.event === "advance_days") return payment;
  const order = await orderOfChat(chat.chatId, company);
  if (!order) throw new Error(`The conversation has no order for ${step.event}`);
  const orderId = order.id as OrderId;
  const run = async <T>(work: () => Promise<Result<T, { code: string; message: string }>>) => {
    const result = await inTenant(company, work);
    if (!result.success) throw new Error(`${step.event} failed: ${result.error.code} ${result.error.message}`);
    return result.data;
  };
  const confirm = async (id: string, source: "manual" | "buyer_report", partial = false) => {
    const aggregate = await run(() => findOrderAggregate(orderId, access.companyId));
    if (!aggregate) throw new Error("Order not found");
    await run(() => registerPayment({ orderId, paymentId: id as PaymentId, source, amount: partial ? { ...aggregate.total, amount: Math.floor(Math.round(aggregate.total.amount * 100) / 2) / 100 } : aggregate.total, method: "digital_wallet", deductStockIfPartial: false },
      access, { transaction, findOrderForUpdate, savePayment, updatePayment, saveCompletion,
        publishPaymentConfirmed: (payload) => publishStockEvent("payment_confirmed", payload), findVariantStock, clock }));
  };
  switch (step.event) {
    case "cancel_order":
      await run(() => cancelOrder(orderId, access, { transaction, findOrderForUpdate, saveCancellation, publishOrderCancelled: async () => ok(undefined), clock }));
      return payment;
    case "report_payment": {
      const checkout = { companyId: access.companyId, orderId };
      await run(() => withinTransaction(async () => {
        const buyer = await saveCheckoutBuyer(checkout, { contactId: chat.contactId as ContactId, name: "Comprador", phone: "+51999999999" });
        return buyer.success ? saveCheckoutConfirmed(checkout, clock()) : buyer;
      }));
      const id = randomUUID();
      const receiptId = randomUUID();
      await inTenant(company, () => prisma.image.create({ data: { id: receiptId, storageKey: `evals/receipts/${receiptId}` } }));
      await run(() => reportPayment({ paymentId: id as PaymentId, receiptImageId: receiptId as PaymentImageId }, { kind: "buyer", companyId: access.companyId, orderId },
        { transaction, findOrderForUpdate, findReceipt: async (image) => ok(image), savePayment, clock }));
      return { id, status: "reported" };
    }
    case "confirm_payment": {
      if (payment?.status === "confirmed") throw new Error("The payment is already confirmed");
      const id = payment?.id ?? randomUUID();
      await confirm(id, payment ? "buyer_report" : "manual", step.partial === true);
      return { id, status: "confirmed" };
    }
    case "void_payment": {
      if (!payment) throw new Error("void_payment needs a payment");
      if (payment.status === "reported") await confirm(payment.id, "buyer_report");
      await run(() => voidPayment({ orderId, paymentId: payment.id as PaymentId }, access, { transaction, findOrderForUpdate, updatePayment, saveCompletion, clock }));
      return null;
    }
  }
}

/**
 * Creates a chat in the eval company of `scope` and seeds its start with no model call (the reader is never reached), for the tests of the
 * seeding itself: what the reader would see is then read from the repositories.
 */
export async function seedChatStart(start: ChatStart, scope: CatalogScope = "eval"): Promise<Readonly<{ chatId: string; company: EvalCompany }>> {
  const company = companyOf(scope);
  const wiring: SeedWiring = {
    readChatMessage: async () => { throw new Error("Seeding a start calls no model"); },
    readiness: { visualModel: "none" as never, hasActiveProducts, hasIndexedProducts },
    limits: readChatMessageLimits({}),
    fitReadingContext: () => { throw new Error("Seeding a start calls no model"); },
    photoStageTimeoutMs: 40_000,
  };
  const chat = await newChat(company);
  await seedStart(chat, start, wiring, company);
  return { chatId: chat.chatId, company };
}
