import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { prisma, withinTransaction, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { createAiToolsFromEnv } from "@core/src/shared/ai-tools/composition";
import type { OrchestrateDependencies } from "@core/src/shared/ai-tools/application/orchestrate";
import { createTextMatching, createVisualSearch, type ImageEmbedder } from "@core/src/features/products/composition";
import { identifyProductsInImage, type IdentifyProductsDependencies, type ImageIdentification } from "@core/src/features/products/application/identify-products-in-image";
import { identifyProductsInText, findTopTextCandidate } from "@core/src/features/products/application/identify-product-in-text";
import { resolveVariant } from "@core/src/features/products/application/resolve-variant";
import { catalogSearchReadiness } from "@core/src/features/products/application/catalog-search-readiness";
import { hasActiveProducts } from "@core/src/features/products/infrastructure/catalog-search-readiness";
import { hasIndexedProducts } from "@core/src/features/products/infrastructure/image-embeddings";
import { readQrCodes } from "@core/src/features/products/infrastructure/qr-code-reader";
import { findSellableVariantsByQrCodes, loadSellableVariants } from "@core/src/features/products/infrastructure/order-stock";
import { findProductIdsOfVariants } from "@core/src/features/products";
import type { ImageId, ProductId } from "@core/src/features/products/domain/product";
import type { ImageBytes, MatchConfidence, VariantQrCode } from "@core/src/features/products/domain/image-identification";
import type { TextIdentification } from "@core/src/features/products/domain/text-identification";
import { applyChatMessage, isRetryableChatMessageError, type ApplyChatMessageDependencies, type ApplyChatMessageOutcome, type ApplyChatMessageError } from "@core/src/features/orders/application/apply-chat-message";
import { createChatToolRegistry } from "@core/src/features/orders/application/chat-message-tools";
import { createChatInterpreter } from "@core/src/features/orders/application/chat-message-interpreter";
import { chatMessageDeadlineMs } from "@core/src/features/orders/application/chat-message-policy";
import { allocateOrderNumber, findChatOrderTargetForUpdate, findOpenChatOrderCandidate, findOrderAggregate, recordProcessedMessage, saveItemChanges, savePendingOrder } from "@core/src/features/orders/infrastructure/order-repository";
import { findOutcome, recordOutcome } from "@core/src/features/orders/infrastructure/chat-message-outcome-repository";
import { isOpenForMessageItems, type ChatId } from "@core/src/features/orders/domain/message-order";
import type { CompanyId, ContactId, OrderId, OrderItemId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import { ensureCustomerForContact, lockContact } from "@core/src/features/contacts";
import { findOrderSourceMessage } from "@core/src/features/chats";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { CustomerId } from "@core/src/features/contacts/domain/contact";
import { describeVariantId, evalId, variantIdOf, type ProductKey } from "@core/evals/fixtures/catalog";
import type { MessageInput, OrderLine } from "@core/evals/cases/schema";
import { evalCompanyId, evalSellerId, readRegisteredImage, registerImageFile } from "@core/evals/lib/eval-catalog";

/**
 * The production code path of message-to-order, wired as `orders/composition.ts` and `products/composition.ts` wire it, against the
 * test database. Faked: image storage (fixture files) and, in the interpretation pass only, the photo identification. Nothing publishes
 * events, so no notice reaches WhatsApp or push. Model certainties are observed by wrapping the model ports, never changed.
 */

export type Certainty = Readonly<{ source: "action" | "visual" | "text" | "variant"; confidence: number }>;

const observed = new AsyncLocalStorage<Certainty[]>();
const observe = (certainty: Certainty) => observed.getStore()?.push(certainty);

/** Runs `work` and returns the model certainties observed during it. */
export async function observingCertainties<T>(work: () => Promise<T>): Promise<Readonly<{ value: T; certainties: readonly Certainty[] }>> {
  const certainties: Certainty[] = [];
  const value = await observed.run(certainties, work);
  return { value, certainties };
}

const inTenant = <T>(work: () => Promise<T>) => withTenantIsolation(evalCompanyId, async () => await work());

type Env = Readonly<Record<string, string | undefined>>;

function observedAi(ai: OrchestrateDependencies): OrchestrateDependencies {
  return { ...ai, decide: async (request, signal) => {
    const answers = await ai.decide(request, signal);
    if (answers.success) observe({ source: "action", confidence: answers.data.action.confidence });
    return answers;
  } };
}

export type ProductionPath = ReturnType<typeof createProductionPath>;

/** Builds the real clients from the env once per suite; throws when the providers are not configured. */
export function createProductionPath(env: Env) {
  const aiTools = createAiToolsFromEnv(env);
  const textMatching = createTextMatching(env);
  const visualSetup = createVisualSearch(env);
  if (!aiTools || !textMatching || !visualSetup.visual || !visualSetup.embedder) throw new Error("The production path needs OPENAI_API_KEY");
  const ai = observedAi(aiTools);
  const identification = { ...textMatching.identification, chooseTextProduct: async (input: Parameters<typeof textMatching.identification.chooseTextProduct>[0], signal: AbortSignal) => {
    const choice = await textMatching.identification.chooseTextProduct(input, signal);
    if (choice.success) observe({ source: "text", confidence: choice.data.confidence });
    return choice;
  } };
  const variants = { ...textMatching.variants, chooseVariant: async (...args: Parameters<typeof textMatching.variants.chooseVariant>) => {
    const choice = await textMatching.variants.chooseVariant(...args);
    if (choice.success) observe({ source: "variant", confidence: choice.data.confidence });
    return choice;
  } };
  const visual = { ...visualSetup.visual, readImage: readRegisteredImage, chooseProduct: async (input: Parameters<NonNullable<typeof visualSetup.visual>["chooseProduct"]>[0]) => {
    const choice = await visualSetup.visual!.chooseProduct(input);
    // Only a chosen product has a certainty to calibrate; «no product» answers carry showsProduct, gated at 0.5 instead.
    if (choice.success && choice.data.kind === "product") observe({ source: "visual", confidence: choice.data.confidence });
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
  const registry = createChatToolRegistry({
    loadSellableVariants: (productIds) => loadSellableVariants(productIds),
    resolveVariant: (input, signal) => resolveVariant(input, variants, signal),
    identifyProductsInText: (lines, signal) => identifyProductsInText(lines, identification, signal),
    findTopTextCandidate: (mention) => findTopTextCandidate(mention, identification),
  });
  const interpretAndApply = createChatInterpreter(registry, ai);
  const readiness = { visualModel: visual.model, hasActiveProducts, hasIndexedProducts };

  return {
    embedder: visualSetup.embedder as ImageEmbedder,
    identifyImage: (image: ImageBytes) => inTenant(() => identifyProductsInImage(image, imageIdentification)),
    identifyText: (mention: string, priceHint: number | null) =>
      inTenant(() => identifyProductsInText([{ mention, priceHint }], identification, AbortSignal.timeout(chatMessageDeadlineMs))),
    /** Applies one message through apply-chat-message, seeding the open order first; `photos` says how the photo is identified. */
    applyMessage: (input: MessageInput, photos: "fixed" | "real") => applyMessage(input, photos, { interpretAndApply, readiness, imageIdentification }),
  };
}

export type TextResult = Result<readonly TextIdentification[], Readonly<{ code: string; message: string }>>;

type Wiring = Readonly<{
  interpretAndApply: ApplyChatMessageDependencies["interpretAndApply"];
  readiness: Parameters<typeof catalogSearchReadiness>[0];
  imageIdentification: IdentifyProductsDependencies;
}>;

type Persistence = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;

/** Copy of the composition's open-order reader (not exported there): the order as the models see it. */
async function findChatOrderContext(chatId: ChatId) {
  const candidate = await findOpenChatOrderCandidate(chatId);
  if (!candidate.success) return candidate;
  if (!candidate.data) return ok({ items: [] });
  const found = await findOrderAggregate(candidate.data, evalCompanyId as CompanyId, "apply_chat_message");
  if (!found.success && found.error.code === "PERSISTENCE_UNAVAILABLE") return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: found.error.message });
  if (!found.success || !found.data || !isOpenForMessageItems(found.data, chatId)) return ok({ items: [] });
  const productIds = await findProductIdsOfVariants(found.data.items.map((item) => item.variantId));
  if (!productIds.success) return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: productIds.error.message });
  return ok({ items: found.data.items.map((item, index) => ({ label: `I${index + 1}`, variantId: item.variantId, productId: productIds.data.get(item.variantId) ?? null,
    productName: item.productName, variantAttributes: item.variantAttributes, quantity: item.quantity, unitPrice: item.unitPrice })) });
}

function dependencies(wiring: Wiring, identify: ApplyChatMessageDependencies["identifyProductsInImage"]): ApplyChatMessageDependencies {
  return {
    findOutcome,
    findSourceMessage: async (id) => {
      const found = await findOrderSourceMessage(id);
      if (!found.success || !found.data) return found as Result<null, Persistence>;
      const message = found.data;
      return ok({ ...message, companyId: message.companyId as string as CompanyId, chatId: message.chatId as ChatId,
        contactId: message.contactId as ContactId, uploadedByUserId: message.uploadedByUserId as string as UserId, imageId: message.imageId as ImageId | null });
    },
    findChatOrderContext,
    readImage: (imageId) => readRegisteredImage(imageId),
    identifyProductsInImage: identify,
    loadSellableProducts: (productIds) => loadSellableVariants(productIds),
    catalogSearchReadiness: () => catalogSearchReadiness(wiring.readiness),
    interpretationEnabled: true,
    interpretAndApply: wiring.interpretAndApply,
    transaction: (_companyId, work) => withinTransaction(work),
    lockContact,
    ensureCustomerForContact: async (contactId) => {
      const ensured = await ensureCustomerForContact(contactId);
      return ensured.success ? ok({ customerId: ensured.data.customerId as CustomerId }) : ensured;
    },
    findChatOrderTargetForUpdate: (chatId) => findChatOrderTargetForUpdate(chatId, findProductIdsOfVariants),
    allocateNumber: () => allocateOrderNumber(evalCompanyId as CompanyId),
    saveNewOrder: (order, link) => savePendingOrder(order, link),
    saveItemChanges,
    recordOrderMessage: recordProcessedMessage,
    recordOutcome,
    newOrderId: () => randomUUID() as OrderId,
    newItemId: () => randomUUID() as OrderItemId,
    clock: () => new Date(),
    limits: { maxItemQuantity: 99 as PositiveInteger },
  };
}

type Chat = Readonly<{ chatId: string; contactId: string }>;

async function newChat(): Promise<Chat> {
  const contactId = randomUUID();
  const chatId = randomUUID();
  await inTenant(async () => {
    await prisma.contact.create({ data: { id: contactId, whatsappAccountId: `${contactId}@lid`, whatsappLid: `${contactId}@lid` } });
    await prisma.chat.create({ data: { id: chatId, contactId } });
  });
  return { chatId, contactId };
}

async function newMessage(chat: Chat, content: Readonly<{ text?: string; caption?: string; imageFile?: string; image?: boolean }>): Promise<ChatMessageId> {
  const messageId = randomUUID() as ChatMessageId;
  const imageId = content.imageFile || content.image ? randomUUID() : null;
  // A photo identified by hand still needs readable bytes: the use case reads the image before identifying it. Any repository CC0 photo will do.
  if (imageId) registerImageFile(imageId, content.imageFile ?? "src/features/products/infrastructure/product-matching/embedding-fixtures/product-a-front.jpg");
  await inTenant(async () => {
    if (imageId) await prisma.image.create({ data: { id: imageId, storageKey: `evals/messages/${imageId}` } });
    await prisma.chatMessage.create({ data: { id: messageId, chatId: chat.chatId, externalId: `ext-${messageId}`, whatsappMessageId: `wa-${messageId}`,
      direction: "incoming", source: "contact", type: imageId ? "image" : "text", imageId, text: content.text ?? null, caption: content.caption ?? null,
      uploadedByUserId: evalSellerId, sentAt: new Date(), receivedAt: new Date() } });
  });
  return messageId;
}

/** A product label photo identified by its QR code, as the cascade reports it. */
async function labelIdentification(product: ProductKey, variant: Readonly<Record<string, string>>): Promise<ImageIdentification> {
  const code = variantIdOf(product, variant);
  const found = await inTenant(() => findSellableVariantsByQrCodes([code]));
  if (!found.success || !found.data.length) throw new Error(`Seeded variant ${code} is missing`);
  return { kind: "found", method: "qr", items: found.data.map((item) => ({ ...item, productId: item.productId as ProductId })), unknownCodes: [] };
}

const fixed = (identification: ImageIdentification): ApplyChatMessageDependencies["identifyProductsInImage"] => async () => ok(identification);

/** Seeds the open order with label photos (QR, no caption): the deterministic path, no model call. */
async function seedOrder(chat: Chat, lines: readonly OrderLine[], wiring: Wiring): Promise<void> {
  for (const line of lines) {
    const identified = await labelIdentification(line.product, line.variant);
    for (let unit = 0; unit < line.quantity; unit += 1) {
      const messageId = await newMessage(chat, { image: true });
      const applied = await inTenant(() => applyChatMessage({ companyId: evalCompanyId as CompanyId, messageId }, dependencies(wiring, fixed(identified)),
        AbortSignal.timeout(chatMessageDeadlineMs)));
      if (!applied.success || applied.data.kind !== "applied" || applied.data.outcomes[0].kind !== "added") throw new Error(`Seeding ${line.product} failed: ${JSON.stringify(applied)}`);
    }
  }
}

export type AppliedLine = Readonly<{ product: ProductKey | null; variant: Readonly<Record<string, string>>; quantity: number; unitPrice: number;
  mentionedPrice: Readonly<{ amount: number; units: number }> | null }>;

export type AppliedMessage = Readonly<{
  result: Result<ApplyChatMessageOutcome, ApplyChatMessageError>;
  /** The chat's latest order after the message, or null when the chat has none. */
  order: readonly AppliedLine[] | null;
  attempts: number;
}>;

async function chatOrderLines(chatId: string): Promise<readonly AppliedLine[] | null> {
  const order = await inTenant(() => prisma.order.findFirst({ where: { chatId }, include: { items: true }, orderBy: { number: "desc" } }));
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
async function photoIdentification(photo: NonNullable<MessageInput["photo"]>, wiring: Wiring): Promise<ApplyChatMessageDependencies["identifyProductsInImage"]> {
  if ("file" in photo) return (image) => identifyProductsInImage(image, wiring.imageIdentification);
  if (photo.shows === "not_product") return fixed({ kind: "not_product" });
  if (photo.label) return fixed(await labelIdentification(photo.shows, photo.label));
  return fixed({ kind: "found", method: "visual", productId: evalId(`product:${photo.shows}`) as ProductId, confidence: 0.95 as MatchConfidence, candidates: 1, topDistance: 0 });
}

const maxAttempts = 3;

async function applyMessage(input: MessageInput, photos: "fixed" | "real", wiring: Wiring): Promise<AppliedMessage> {
  const chat = await newChat();
  await seedOrder(chat, input.order, wiring);
  if (photos === "fixed" && input.photo && "file" in input.photo) throw new Error("The interpretation pass identifies photos by hand");
  const identify = input.photo ? await photoIdentification(input.photo, wiring) : fixed({ kind: "not_product" });
  const messageId = await newMessage(chat, input.photo
    ? { caption: input.caption, ...("file" in input.photo ? { imageFile: input.photo.file } : { image: true }) }
    : { text: input.text });
  // Retryable failures are retried as the queue would; each attempt repeats every paid stage, as in production.
  let attempts = 0;
  let result: AppliedMessage["result"];
  do {
    attempts += 1;
    result = await inTenant(() => applyChatMessage({ companyId: evalCompanyId as CompanyId, messageId }, dependencies(wiring, identify), AbortSignal.timeout(chatMessageDeadlineMs)));
  } while (!result.success && isRetryableChatMessageError(result.error) && attempts < maxAttempts);
  return { result, order: await chatOrderLines(chat.chatId), attempts };
}
