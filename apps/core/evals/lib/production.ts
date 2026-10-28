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
import { readQrCodes } from "@core/src/shared/images/infrastructure/qr-code-reader";
import { findSellableVariantsByQrCodes, loadSellableVariants } from "@core/src/features/products/infrastructure/order-stock";
import { findProductIdsOfVariants } from "@core/src/features/products";
import type { ImageId, ProductId } from "@core/src/features/products/domain/product";
import { minShowsProduct, type ImageBytes, type MatchConfidence, type VariantQrCode } from "@core/src/features/products/domain/image-identification";
import type { TextIdentification } from "@core/src/features/products/domain/text-identification";
import { applyChatMessage, isRetryableChatMessageError, type ApplyChatMessageDependencies, type ApplyChatMessageOutcome, type ApplyChatMessageError } from "@core/src/features/orders/application/apply-chat-message";
import { createChatToolRegistry } from "@core/src/features/orders/application/chat-message-tools";
import { ITEM_CHOICE_MIN_CONFIDENCE } from "@core/src/features/orders/application/chat-text-tools";
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
import { describeVariantId, evalId, productById, variantIdOf, type ProductKey } from "@core/evals/fixtures/catalog";
import type { MessageInput, OrderLine } from "@core/evals/cases/schema";
import { evalCompanyId, evalSellerId, readRegisteredImage, registerImageFile } from "@core/evals/lib/eval-catalog";

/**
 * The production code path of message-to-order, wired as `orders/composition.ts` and `products/composition.ts` wire it, against the
 * test database. Faked: image storage (fixture files) and, in the interpretation pass only, the photo identification. Nothing publishes
 * events, so no notice reaches WhatsApp or push. Model answers are observed by wrapping the model ports, never changed.
 */

/**
 * A model certainty and the production gate it is compared with. `*_none` sources are answers that pick nothing (the text, variant
 * or vision chooser's «none»); they are reported apart, never as confident picks. `shows_product` is the vision chooser's probability
 * that the photo shows a product, at its 0.5 gate, with «product» or «not_product» as pick. `item` is the Decision choice of an order item or an amount,
 * kept only for the tools that ran.
 */
export type CertaintySource = "action" | "visual" | "visual_none" | "shows_product" | "text" | "text_none" | "variant" | "variant_none" | "item";
/**
 * `pick` is the model's own answer, independent of what the gate then decided: the Decision's action, the product key chosen for a
 * mention or a photo (null for «none»), or the chosen variant's attribute values joined by spaces. Calibration grades it.
 */
export type Certainty = Readonly<{ source: CertaintySource; confidence: number; gate: number; pick?: string | null; detail?: string }>;

/** What the Decision API answered for the message: the action, the three highest tool predicates (the runner-ups), and the choices. */
export type DecisionTrace = Readonly<{
  action: string;
  confidence: number;
  predicates: readonly Readonly<{ tool: string; probability: number }>[];
  choices: Readonly<Record<string, Readonly<{ value: string | boolean; confidence: number }>>>;
}>;

/** What the models decided while one case ran: certainties, Decision answers, extracted tool arguments and text choices. */
export type Observation = {
  certainties: Certainty[];
  decisions: DecisionTrace[];
  extracted: { tool: string; args: unknown }[];
  textChoices: { mention: string; product: string | null; confidence: number }[];
};

const newObservation = (): Observation => ({ certainties: [], decisions: [], extracted: [], textChoices: [] });
const observed = new AsyncLocalStorage<Observation>();
const current = () => observed.getStore();
const observe = (certainty: Certainty) => current()?.certainties.push(certainty);

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

const inTenant = <T>(work: () => Promise<T>) => withTenantIsolation(evalCompanyId, async () => await work());

type Env = Readonly<Record<string, string | undefined>>;

function observedAi(ai: OrchestrateDependencies): OrchestrateDependencies {
  return {
    ...ai,
    decide: async (request, signal) => {
      const answers = await ai.decide(request, signal);
      if (answers.success) {
        const { action, predicates, choices } = answers.data;
        observe({ source: "action", confidence: action.confidence, gate: ai.minActionConfidence, pick: action.choice, detail: action.choice });
        const ranked = Object.entries(predicates).map(([tool, probability]) => ({ tool, probability })).sort((a, b) => b.probability - a.probability).slice(0, 3);
        current()?.decisions.push({ action: action.choice, confidence: action.confidence, predicates: ranked, choices });
      }
      return answers;
    },
    extract: async (request, signal) => {
      const calls = await ai.extract(request, signal);
      if (calls.success) current()?.extracted.push(...calls.data.map(({ tool, args }) => ({ tool, args })));
      return calls;
    },
  };
}

/**
 * The item and amount choices of the tools that ran, gated in production by ITEM_CHOICE_MIN_CONFIDENCE. The Decision API answers
 * the questions of every offered tool; only those of executed tools decided anything.
 */
export function itemCertainties(decision: DecisionTrace | undefined, tools: readonly string[]): readonly Certainty[] {
  if (!decision) return [];
  return Object.entries(decision.choices).filter(([id]) => tools.includes(id.split(":")[0]!))
    .map(([id, answer]) => ({ source: "item" as const, confidence: answer.confidence, gate: ITEM_CHOICE_MIN_CONFIDENCE, detail: `${id}=${String(answer.value)}` }));
}

export type ProductionPath = ReturnType<typeof createProductionPath>;

/** Builds the real clients from the env once per suite; throws when the providers are not configured. */
export function createProductionPath(env: Env) {
  const aiTools = createAiToolsFromEnv(env);
  const textMatching = createTextMatching(env);
  const visualSetup = createVisualSearch(env);
  if (!aiTools || !textMatching || !visualSetup.visual || !visualSetup.embedder) throw new Error("The production path needs OPENAI_API_KEY");
  const ai = observedAi(aiTools);
  const textGate = textMatching.identification.minConfidence;
  const identification = { ...textMatching.identification, chooseTextProduct: async (input: Parameters<typeof textMatching.identification.chooseTextProduct>[0], signal: AbortSignal) => {
    const choice = await textMatching.identification.chooseTextProduct(input, signal);
    if (choice.success) {
      const product = choice.data.productId === null ? null : productById(choice.data.productId)?.key ?? choice.data.productId;
      observe({ source: product === null ? "text_none" : "text", confidence: choice.data.confidence, gate: textGate, pick: product, detail: `${input.mention} → ${product ?? "none"}` });
      current()?.textChoices.push({ mention: input.mention, product, confidence: choice.data.confidence });
    }
    return choice;
  } };
  const variants = { ...textMatching.variants, chooseVariant: async (...args: Parameters<typeof textMatching.variants.chooseVariant>) => {
    const choice = await textMatching.variants.chooseVariant(...args);
    if (choice.success) {
      const values = choice.data.variantId === null ? null : Object.values(describeVariantId(choice.data.variantId)?.attributes ?? {}).join(" ");
      observe({ source: values === null ? "variant_none" : "variant", confidence: choice.data.confidence, gate: textMatching.variants.minConfidence,
        pick: values, detail: `${args[0].words.join(" ")} → ${values ?? "none"}` });
    }
    return choice;
  } };
  const visual = { ...visualSetup.visual, readImage: readRegisteredImage, chooseProduct: async (input: Parameters<NonNullable<typeof visualSetup.visual>["chooseProduct"]>[0]) => {
    const choice = await visualSetup.visual!.chooseProduct(input);
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
  const registry = createChatToolRegistry({
    loadSellableVariants: (productIds) => loadSellableVariants(productIds),
    resolveVariant: (input, signal) => resolveVariant(input, variants, signal),
    identifyProductsInText: (lines, signal) => identifyProductsInText(lines, identification, signal),
    findTopTextCandidate: (mention) => findTopTextCandidate(mention, identification),
  });
  const interpretAndApply = createChatInterpreter(registry, ai);
  const readiness = { visualModel: visual.model, hasActiveProducts, hasIndexedProducts };

  return {
    /** The production gates the certainties are compared with, as configured by the same env. */
    gates: { action: aiTools.minActionConfidence, toolPredicate: aiTools.minToolPredicate, reportPredicate: aiTools.minReportPredicate, text: textGate, textUnclear: textMatching.identification.unclearMinProbability,
      variant: textMatching.variants.minConfidence, visual: visualSetup.visual.minConfidence, item: ITEM_CHOICE_MIN_CONFIDENCE },
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
  /** Duration of the scored (last) applyChatMessage attempt: no chat creation, order seeding or earlier attempts. */
  latencyMs: number;
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
  let latencyMs: number;
  let result: AppliedMessage["result"];
  do {
    attempts += 1;
    resetObservation();
    const started = performance.now();
    result = await inTenant(() => applyChatMessage({ companyId: evalCompanyId as CompanyId, messageId }, dependencies(wiring, identify), AbortSignal.timeout(chatMessageDeadlineMs)));
    latencyMs = Math.round(performance.now() - started);
  } while (!result.success && isRetryableChatMessageError(result.error) && attempts < maxAttempts);
  return { result, order: await chatOrderLines(chat.chatId), attempts, latencyMs };
}
