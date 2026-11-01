import type { Money } from "@shared/money";
import type { ChatMessageOutcome, ProductIdentification } from "@core/src/features/orders/domain/chat-message-outcome";
import type { ChangeVariantResolution, ItemTarget, ReportOutcome, ResolvedChatAction } from "@core/src/features/orders/domain/chat-order";
import { maxPendingCandidates, type ChatPending, type PhotoLeft } from "@core/src/features/orders/domain/chat-pendings";
import { mentionedPriceOf, type StatedPrice } from "@core/src/features/orders/domain/mentioned-price";
import type { PositiveInteger } from "@core/src/features/orders/domain/order";
import { conflictsWithKnown, describePendings, normalizeValue, pendingPriceOf, resolveVariant, type AdvanceRequest, type AttributeChoice } from "@core/src/features/orders/domain/pending-transitions";
import { choicesFromWords, openAttributes, questionValues } from "@core/src/features/orders/domain/reader/check-questions";
import type { CheckedAction } from "@core/src/features/orders/domain/reader/decide";
import type { CertaintySignals, DoubtReason, ProblemKind } from "@core/src/features/orders/domain/reader/decision";
import type { VerifiedRequest } from "@core/src/features/orders/domain/reader/quotes";
import type { BuyerLanguage, ContextMessageRef, ExtractedRequest, ItemRef, PendingRef, ProductResolution } from "@core/src/features/orders/domain/reader/readings";
import type { SuggestedQuestion } from "@core/src/features/orders/domain/suggested-question";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";
import type { ProductForReading } from "@core/src/features/products/domain/reading-product";

export type { CheckedAction };

/** A product of the catalog search; `shown` marks the one a photo of this message showed. */
export type CheckProduct = ProductForReading & Readonly<{ shown: boolean; shownVariantId: VariantId | null; identification: ProductIdentification | null }>;
export type CheckItem = Readonly<{ ref: ItemRef; variantId: VariantId; productId: ProductId | null; productName: string; variantAttributes: Readonly<Record<string, string>>;
  quantity: number; unitPrice: Money }>;
/** What the last photo in the context was about, for the photo-then-variant guard. */
export type LastPhoto = Readonly<{ kind: "none" | "not_identified" }> | Readonly<{ kind: "product"; productId: ProductId; added: boolean }>;
/** The locked state the checks read. Nothing in it came from a model. */
export type CheckSnapshot = Readonly<{
  messageKind: "text" | "photo_product" | "photo_not_product";
  language: BuyerLanguage;
  products: readonly CheckProduct[];
  items: readonly CheckItem[];
  pendings: readonly Readonly<{ ref: PendingRef; pending: ChatPending }>[];
  order: "open" | "closed" | "none";
  photoJustSent: PhotoLeft | null;
  lastPhoto: LastPhoto;
  /** The products each context message mentioned. */
  contextProducts: ReadonlyMap<ContextMessageRef, readonly ProductId[]>;
}>;

type Urgent = NonNullable<CheckedAction["urgent"]>;
type Said = Readonly<{ request: ExtractedRequest; complete: boolean }>;
type Env = Readonly<{ snapshot: CheckSnapshot; resolutions: readonly ProductResolution[]; claims: ReadonlyMap<string, number> }>;
type Named = CertaintySignals["targetNamed"];

const changeKinds: ReadonlySet<ExtractedRequest["kind"]> = new Set(["add", "remove", "change_quantity", "change_variant", "complete_pending", "mention_price"]);
const itemKinds: ReadonlySet<ExtractedRequest["kind"]> = new Set(["remove", "change_quantity", "change_variant", "mention_price"]);
const maxQuestionProducts = 10;

const report = (outcome: ReportOutcome): ResolvedChatAction => ({ kind: "report", outcome });
const invalid = (reason: Extract<ChatMessageOutcome, { kind: "invalid_action" }>["reason"]): ResolvedChatAction => report({ kind: "invalid_action", orderId: null, reason });
const textIdentification = (productId: ProductId): ProductIdentification => ({ method: "text", productId, confidence: null });
const identificationOf = (product: CheckProduct): ProductIdentification => product.identification ?? textIdentification(product.productId);
const signalsOf = (said: Said, targetNamed: Named, over: Partial<CertaintySignals> = {}): CertaintySignals =>
  ({ quotesComplete: said.complete, targetNamed, variantChangeVerb: "not_applicable", candidates: "single", ...over });
const checked = (said: Said, action: ResolvedChatAction, signals: CertaintySignals, over: Partial<Pick<CheckedAction, "doubt" | "urgent" | "blocked">> = {}): CheckedAction =>
  ({ request: said.request.request, action, signals, doubt: null, urgent: null, blocked: null, ...over });
const problem = (said: Said, outcome: ReportOutcome, problemKind: ProblemKind | null, question: SuggestedQuestion | null, named: Named = "context"): CheckedAction =>
  checked(said, report(outcome), signalsOf(said, named), { urgent: { problem: problemKind ?? "reader_doubt", question } });
const names = (items: readonly Readonly<{ productName: string }>[]): readonly string[] => [...new Set(items.map((item) => item.productName))].slice(0, maxQuestionProducts);
const orNull = <T,>(list: readonly T[], build: (list: readonly T[]) => SuggestedQuestion): SuggestedQuestion | null => (list.length > 0 ? build(list) : null);
const statedOf = (price: NonNullable<ExtractedRequest["price"]>): StatedPrice => ({ amount: String(price.amount), currency: price.currency === "order" ? "not_named" : "other", per: price.basis });
const whole = (value: number | undefined, minimum: number): boolean => value === undefined || (Number.isInteger(value) && value >= minimum);

/**
 * Turns the verified readings and product resolutions into resolved actions with their certainty signals, against the locked state.
 * Pure: no value of a model reaches the order except through a catalog variant, and every failed check is a report that leaves the rest applied.
 */
export function checkRequests(requests: readonly VerifiedRequest[], resolutions: readonly ProductResolution[], snapshot: CheckSnapshot): readonly CheckedAction[] {
  if (snapshot.messageKind === "photo_not_product") {
    const first = requests.find((entry) => changeKinds.has(entry.request.kind));
    return first ? [checked(first, report({ kind: "image_with_request" }), signalsOf(first, "context"), { urgent: { problem: "image_with_request", question: null } })] : [];
  }
  const claims = new Map<string, number>();
  for (const entry of requests) {
    const id = claimedPending(entry.request, snapshot);
    if (id) claims.set(id, (claims.get(id) ?? 0) + 1);
  }
  const env: Env = { snapshot, resolutions, claims };
  return requests.flatMap((entry) => checkOne(entry, env));
}

/** A remove or quantity change that lands on a pending, which lives without an order. */
function onPending(request: ExtractedRequest, snapshot: CheckSnapshot): boolean {
  if (request.kind === "change_quantity") return pendingOfRequest(request, snapshot) !== undefined || (request.target.kind === "photo_just_sent" && snapshot.photoJustSent?.kind === "pending");
  return request.kind === "remove" && request.target.kind === "pending" && pendingOfRequest(request, snapshot) !== undefined;
}

function checkOne(said: Said, env: Env): readonly CheckedAction[] {
  const { request } = said;
  const { snapshot } = env;
  if (itemKinds.has(request.kind) && snapshot.order !== "open" && !onPending(request, snapshot)) {
    const blocked = snapshot.order === "closed" ? "order_closed" : "no_open_order";
    return [checked(said, { kind: "change_unfound_item", target: { kind: "unnamed" } }, signalsOf(said, "context"), { blocked })];
  }
  switch (request.kind) {
    case "add": return checkAdd(said, env);
    case "remove": return [checkRemove(said, env)];
    case "change_quantity": return [checkQuantity(said, env)];
    case "change_variant": return [checkVariant(said, env)];
    case "mention_price": return [checkPrice(said, env)];
    case "complete_pending": return [checkComplete(said, env)];
    case "decline": return [checkDecline(said, env)];
    case "ready": return [checked(said, { kind: "ready" }, signalsOf(said, "named"))];
    case "payment_request": return [checked(said, report({ kind: "payment_requested", order: { kind: "none" }, productIds: [], unnamed: 0 }), signalsOf(said, "named"))];
    case "not_allowed": return [problem(said, { kind: "request_not_allowed", orderId: null }, "request_not_allowed", null, "named")];
  }
}

// ---- items ----

type FoundItem =
  | Readonly<{ kind: "found"; item: CheckItem; named: boolean }>
  | Readonly<{ kind: "many"; productId: ProductId | null; named: boolean }>
  | Readonly<{ kind: "none"; productId: ProductId | null; named: boolean }>;

const itemOfRef = (ref: string, snapshot: CheckSnapshot): CheckItem | undefined => snapshot.items.find((item) => item.ref === ref);
const resolutionOf = (request: ExtractedRequest, env: Env): ProductResolution | undefined => env.resolutions.find((resolution) => resolution.request === request.request);

/** The order item a request points to: by reference, by the product it names, or the only item the order has. */
function findItem(request: ExtractedRequest, env: Env): FoundItem {
  const { items } = env.snapshot;
  const { target } = request;
  if (target.kind === "item" || (target.kind === "context" && target.basis === "only_item")) {
    const item = itemOfRef(target.ref, env.snapshot);
    const named = target.kind === "item" && target.named !== null;
    return item ? { kind: "found", item, named } : { kind: "none", productId: null, named };
  }
  if (target.kind === "named") {
    const resolution = resolutionOf(request, env);
    const productId = resolution?.kind === "chosen" ? resolution.productId : null;
    const matching = productId ? items.filter((item) => item.productId === productId) : [];
    const [only, ...more] = matching;
    if (only) return more.length === 0 ? { kind: "found", item: only, named: true } : { kind: "many", productId, named: true };
    return { kind: "none", productId, named: true };
  }
  if (target.kind === "pending") return { kind: "none", productId: null, named: false };
  const [only, ...more] = items;
  if (only && more.length === 0) return { kind: "found", item: only, named: false };
  return more.length > 0 ? { kind: "many", productId: null, named: false } : { kind: "none", productId: null, named: false };
}

const variantTarget = (item: CheckItem): ItemTarget => ({ kind: "variant", variantId: item.variantId });
const named = (found: Extract<FoundItem, { kind: "found" }>): Named => (found.named ? "named" : "context");

/** An item the request could not be pointed at: unclear when the order has items to choose among, otherwise the reason the message has no target. */
function unfoundItem(said: Said, found: Exclude<FoundItem, { kind: "found" }>, env: Env, question: (items: readonly CheckItem[]) => SuggestedQuestion | null = () => null): CheckedAction {
  const { items } = env.snapshot;
  if (found.named) return checked(said, { kind: "change_unfound_item", target: { kind: "unclear", namedItem: true, namedProductId: found.productId } }, signalsOf(said, "named"), { urgent: { problem: "unclear_item", question: null } });
  return problem(said, { kind: "unclear_item", orderId: null, namedItem: false, namedProductId: null }, "unclear_item", items.length > 1 ? question(items) : null);
}

/** The pending a request points to: by reference, or the only one there is when the photo just sent no longer counts. */
function pendingOfRequest(request: ExtractedRequest, snapshot: CheckSnapshot): ChatPending | undefined {
  const { target } = request;
  if (target.kind === "pending") return snapshot.pendings.find((entry) => entry.ref === target.ref)?.pending;
  const [only, ...more] = snapshot.pendings;
  return target.kind === "photo_just_sent" && snapshot.photoJustSent === null && only && more.length === 0 ? only.pending : undefined;
}

function checkRemove(said: Said, env: Env): CheckedAction {
  const pending = said.request.target.kind === "pending" ? pendingOfRequest(said.request, env.snapshot) : undefined;
  const { quantity } = said.request;
  const pendingNamed: Named = said.request.target.kind === "pending" && said.request.target.named !== null ? "named" : "context";
  if (pending && quantity?.mode === "decrease") {
    if (!whole(quantity.value, 1)) return checked(said, invalid("quantity_not_whole"), signalsOf(said, pendingNamed), { urgent: { problem: "invalid_action", question: null } });
    return pendingQuantity(said, pending, quantity, pendingNamed);
  }
  if (pending) return checked(said, { kind: "decline_pending", pendingId: pending.id }, signalsOf(said, pendingNamed));
  const found = findItem(said.request, env);
  if (found.kind !== "found") {
    return unfoundItem(said, found, env, (items) => orNull(names(items), (products) => ({ language: env.snapshot.language, kind: "which_item_to_remove", products })));
  }
  const signals = signalsOf(said, named(found));
  if (quantity?.mode === "decrease") {
    if (!whole(quantity.value, 1)) return checked(said, invalid("quantity_not_whole"), signals, { urgent: { problem: "invalid_action", question: null } });
    return checked(said, { kind: "lower_quantity", target: variantTarget(found.item), quantity: quantity.value as PositiveInteger }, signals, { doubt: loweredDoubt(found.item, quantity.value) });
  }
  return checked(said, { kind: "remove", target: variantTarget(found.item), amount: "all" }, signals, { doubt: { kind: "removed", product: found.item.productName } });
}

const loweredDoubt = (item: CheckItem, by: number): DoubtReason =>
  item.quantity - by >= 1 ? { kind: "quantity_set", quantity: (item.quantity - by) as PositiveInteger } : { kind: "removed", product: item.productName };

function checkQuantity(said: Said, env: Env): CheckedAction {
  const { request } = said;
  const { quantity } = request;
  if (!quantity) return checked(said, invalid("quantity_not_whole"), signalsOf(said, "context"), { urgent: { problem: "invalid_action", question: null } });
  if (!whole(quantity.value, quantity.mode === "set" ? 0 : 1)) return checked(said, invalid("quantity_not_whole"), signalsOf(said, "context"), { urgent: { problem: "invalid_action", question: null } });
  const justSent = request.target.kind === "photo_just_sent" ? photoQuantity(said, env, quantity) : null;
  if (justSent) return justSent;
  const pending = pendingOfRequest(request, env.snapshot);
  if (pending) return pendingQuantity(said, pending, quantity, request.target.kind === "pending" && request.target.named !== null ? "named" : "context");
  const found = findItem(request, env);
  if (found.kind !== "found") {
    if (found.kind === "none" && !found.named && env.snapshot.items.length === 0) return problem(said, { kind: "unnamed_add" }, "unnamed_add", { language: env.snapshot.language, kind: "another_of_which" });
    return unfoundItem(said, found, env);
  }
  const { item } = found;
  const target = variantTarget(item);
  const signals = signalsOf(said, named(found));
  switch (quantity.mode) {
    case "set": return checked(said, { kind: "set_quantity", target, quantity: quantity.value }, signals, { doubt: quantity.value >= 1 ? { kind: "quantity_set", quantity: quantity.value as PositiveInteger } : { kind: "removed", product: item.productName } });
    case "add": return checked(said, { kind: "increase_quantity", target, quantity: quantity.value as PositiveInteger }, signals, { doubt: { kind: "added_by_reference", quantity: quantity.value as PositiveInteger, quote: null } });
    case "decrease": return checked(said, { kind: "lower_quantity", target, quantity: quantity.value as PositiveInteger }, signals, { doubt: loweredDoubt(item, quantity.value) });
  }
}

/** A quantity change on a pending: low risk, and never better than «Con duda» unless it is high certainty. */
function pendingQuantity(said: Said, pending: ChatPending, quantity: Pick<NonNullable<ExtractedRequest["quantity"]>, "value" | "mode">, targetNamed: Named, over: Partial<CertaintySignals> = {}): CheckedAction {
  const otherwise = report({ kind: "unclear_item", orderId: null, namedItem: false, namedProductId: null });
  const mode = quantity.mode === "add" ? "increase" : quantity.mode;
  const next = mode === "set" ? quantity.value : mode === "increase" ? pending.quantity + quantity.value : pending.quantity - quantity.value;
  const doubt: DoubtReason | null = next >= 1 ? { kind: "quantity_set", quantity: next as PositiveInteger } : null;
  return checked(said, { kind: "change_pending_quantity", pendingId: pending.id, mode, quantity: quantity.value, price: null, otherwise }, signalsOf(said, targetNamed, over), { doubt });
}

/** A quantity for what the photo just sent left: set wording counts as named, add and decrease wording stay context. Null when nothing is left or it is gone. */
function photoQuantity(said: Said, env: Env, quantity: Pick<NonNullable<ExtractedRequest["quantity"]>, "value" | "mode">): CheckedAction | null {
  const { photoJustSent: left, pendings, items } = env.snapshot;
  const signals = signalsOf(said, quantity.mode === "set" ? "photo_just_sent_set" : "context");
  if (left?.kind === "pending") {
    const pending = pendings.find((entry) => entry.pending.id === left.pendingId)?.pending;
    if (!pending) return null;
    return pendingQuantity(said, pending, quantity, quantity.mode === "set" ? "photo_just_sent_set" : "context");
  }
  if (left?.kind === "item") {
    const item = items.find((line) => line.variantId === left.variantId);
    if (!item) return null;
    if (quantity.mode === "set") {
      return checked(said, { kind: "set_photo_item_quantity", orderId: left.orderId, variantId: left.variantId, expectedQuantity: left.quantity, quantity: quantity.value, otherwise: report({ kind: "unclear_item", orderId: null, namedItem: false, namedProductId: null }) }, signals,
        { doubt: quantity.value >= 1 ? { kind: "quantity_set", quantity: quantity.value as PositiveInteger } : { kind: "removed", product: item.productName } });
    }
    const target = variantTarget(item);
    return quantity.mode === "add"
      ? checked(said, { kind: "increase_quantity", target, quantity: quantity.value as PositiveInteger }, signals, { doubt: { kind: "added_by_reference", quantity: quantity.value as PositiveInteger, quote: null } })
      : checked(said, { kind: "lower_quantity", target, quantity: quantity.value as PositiveInteger }, signals, { doubt: loweredDoubt(item, quantity.value) });
  }
  return null;
}

function checkPrice(said: Said, env: Env): CheckedAction {
  const found = findItem(said.request, env);
  if (found.kind !== "found") return unfoundItem(said, found, env);
  const { price } = said.request;
  const mentioned = price ? mentionedPriceOf(statedOf(price), found.item.quantity, found.item.unitPrice) : null;
  const doubt: DoubtReason | null = mentioned ? { kind: "price_noted", amount: mentioned.amount.amount, units: mentioned.units as PositiveInteger } : null;
  return checked(said, { kind: "set_mentioned_price", target: variantTarget(found.item), price: mentioned }, signalsOf(said, named(found)), { doubt });
}

// ---- variants ----

const productOfItem = (item: CheckItem, snapshot: CheckSnapshot): CheckProduct | undefined => snapshot.products.find((product) => product.productId === item.productId);
const offersValues = (item: CheckItem, choices: (product: CheckProduct) => readonly AttributeChoice[], snapshot: CheckSnapshot): boolean => {
  const product = productOfItem(item, snapshot);
  return product !== undefined && resolveVariant(product, item.variantAttributes, choices(product)).kind !== "not_offered";
};

/** Photo-then-variant guard: a text that only names a variant never changes an item the last photo is not about. */
const photoAllows = (item: CheckItem, lastPhoto: LastPhoto): boolean =>
  lastPhoto.kind === "none" || (lastPhoto.kind === "product" && lastPhoto.added && lastPhoto.productId === item.productId);

function checkVariant(said: Said, env: Env): CheckedAction {
  const { request } = said;
  const { snapshot } = env;
  const valueWord = request.values[0]?.valueWords.text ?? "";
  const choicesOf = (product: CheckProduct) => choicesFromWords(product, request.values);
  const variantOnly = (items: readonly CheckItem[], kind: "variant_for_which" | "which_product_for_value"): CheckedAction =>
    problem(said, { kind: "variant_only" }, "variant_only", valueWord ? orNull(names(items), (products) => ({ language: snapshot.language, kind, value: valueWord, products })) : null);
  let found = findItem(request, env);
  if (found.kind === "many" && !found.named) {
    const fitting = snapshot.items.filter((item) => offersValues(item, choicesOf, snapshot));
    const [only, ...more] = fitting;
    if (only && more.length === 0) found = { kind: "found", item: only, named: false };
    else return variantOnly(fitting.length > 0 ? fitting : snapshot.items, "variant_for_which");
  }
  if (found.kind !== "found") return found.named ? unfoundItem(said, found, env) : variantOnly(snapshot.items, "which_product_for_value");
  const { item } = found;
  if (!found.named && !photoAllows(item, snapshot.lastPhoto)) return variantOnly([item], "which_product_for_value");
  const product = productOfItem(item, snapshot);
  if (!product) return problem(said, { kind: "unclear_item", orderId: null, namedItem: found.named, namedProductId: item.productId }, "unclear_item", null);
  if (!product.sellable) return problem(said, { kind: "product_not_available", productId: product.productId }, "product_not_available", null);
  const choices = choicesOf(product);
  const resolution = resolveVariant(product, item.variantAttributes, choices);
  const signals = signalsOf(said, named(found), { variantChangeVerb: request.changeVerb ? "present" : "absent" });
  if (resolution.kind !== "resolved") {
    const urgent = variantProblem(product, resolution.kind === "open" ? "variant_missing" : "variant_not_available", resolution.known, choices, snapshot.language);
    return checked(said, report({ kind: urgent.problem as "variant_missing" | "variant_not_available", productId: product.productId, identification: null }), signals, { urgent });
  }
  const to: ChangeVariantResolution = { kind: "resolved", item: resolution.item };
  const mentionedPrice = request.price ? mentionedPriceOf(statedOf(request.price), item.quantity, resolution.item.unitPrice) : null;
  return checked(said, { kind: "change_variant", target: variantTarget(item), to, mentionedPrice }, signals, { doubt: variantDoubt(item, resolution.item.variantAttributes) });
}

function variantDoubt(from: CheckItem, to: Readonly<Record<string, string>>): DoubtReason | null {
  const attribute = Object.keys(to).find((name) => to[name] !== from.variantAttributes[name]);
  return attribute === undefined ? null : { kind: "variant_changed", attribute, from: from.variantAttributes[attribute] ?? "", to: to[attribute] ?? "" };
}

/** The problem and question for a product whose variant is not complete or not sold. */
function variantProblem(product: CheckProduct, kind: "variant_missing" | "variant_not_available", known: Readonly<Record<string, string>>, choices: readonly AttributeChoice[], language: BuyerLanguage): Urgent {
  const open = openAttributes(product, known);
  if (kind === "variant_missing") {
    const [first] = open;
    return { problem: kind, question: first ? { language, kind: "which_variant", product: product.name, attribute: first.name, values: questionValues(first.values) } : null };
  }
  const offered = (choice: AttributeChoice) => product.attributes.some((attribute) => attribute.values.some((value) => normalizeValue(value) === normalizeValue(choice.value)));
  const asked = choices.find((choice) => !offered(choice))?.value ?? choices[0]?.value ?? "";
  const [only, ...more] = openAttributes(product, {});
  const question: SuggestedQuestion | null = asked !== "" && only && more.length === 0
    ? { language, kind: "variant_unavailable", product: product.name, asked, attribute: only.name, values: questionValues(only.values) } : null;
  return { problem: kind, question };
}

// ---- adds ----

/** The quantity an add states; one when it states none. Null when it is not a whole number from 1. */
const quantityOf = (request: ExtractedRequest): number | null => {
  const value = request.quantity?.value;
  return value === undefined ? 1 : whole(value, 1) ? value : null;
};

const qrChoices = (product: CheckProduct): readonly AttributeChoice[] => {
  const variant = product.shownVariantId ? product.variants.find((candidate) => candidate.variantId === product.shownVariantId) : undefined;
  return Object.entries(variant?.variantAttributes ?? {}).map(([name, value]) => ({ name, value }));
};

function checkAdd(said: Said, env: Env): readonly CheckedAction[] {
  const { request } = said;
  const { snapshot } = env;
  const quantity = quantityOf(request);
  if (quantity === null) return [checked(said, invalid("quantity_not_whole"), signalsOf(said, "context"), { urgent: { problem: "invalid_action", question: null } })];
  const { target } = request;
  if (target.kind === "photo_same_message") return checkShown(said, env, quantity);
  if (target.kind === "named") return [checkNamedAdd(said, env, quantity)];
  if (target.kind === "photo_just_sent") {
    const grown = photoQuantity(said, env, { value: quantity, mode: "add" });
    if (grown) return [grown];
    const pending = pendingOfRequest(request, snapshot);
    if (pending) return [pendingQuantity(said, pending, { value: quantity, mode: "add" }, "context")];
  }
  return [checkReferencedAdd(said, env, quantity, snapshot)];
}

const unnamedAdd = (said: Said, language: BuyerLanguage): CheckedAction =>
  problem(said, { kind: "unnamed_add" }, "unnamed_add", { language, kind: "another_of_which" });

/** «otro igual»: the product the context points to, when it is a single one. */
function checkReferencedAdd(said: Said, env: Env, quantity: number, snapshot: CheckSnapshot): CheckedAction {
  const { target } = said.request;
  const signals = signalsOf(said, "context");
  const added: DoubtReason = { kind: "added_by_reference", quantity: quantity as PositiveInteger, quote: null };
  let productIds: readonly ProductId[] = [];
  if (target.kind === "context" && target.basis === "mentioned_product") productIds = snapshot.contextProducts.get(target.ref as ContextMessageRef) ?? [];
  else if (target.kind === "context" && target.basis === "last_photo" && snapshot.lastPhoto.kind === "product") productIds = [snapshot.lastPhoto.productId];
  else if (target.kind === "item") {
    const item = itemOfRef(target.ref, snapshot);
    if (item) return checked(said, { kind: "increase_quantity", target: variantTarget(item), quantity: quantity as PositiveInteger }, signalsOf(said, target.named ? "named" : "context"), { doubt: added });
  }
  const [only, ...more] = [...new Set(productIds)];
  if (!only || more.length > 0) return unnamedAdd(said, snapshot.language);
  const inOrder = snapshot.items.filter((item) => item.productId === only);
  const [line, ...others] = inOrder;
  if (line && others.length === 0) return checked(said, { kind: "increase_quantity", target: variantTarget(line), quantity: quantity as PositiveInteger }, signals, { doubt: added });
  const product = snapshot.products.find((candidate) => candidate.productId === only);
  if (!product) return unnamedAdd(said, snapshot.language);
  return withProduct(said, env, product, [], quantity, signals, added);
}

function checkNamedAdd(said: Said, env: Env, quantity: number): CheckedAction {
  const { snapshot } = env;
  const signals = signalsOf(said, "named");
  const resolution = resolutionOf(said.request, env);
  if (!resolution || resolution.kind === "none") {
    if (snapshot.messageKind === "photo_product") return checked(said, invalid("not_the_shown_product"), signals, { urgent: { problem: "invalid_action", question: null } });
    return checked(said, report({ kind: "not_identified", source: "text", identification: null, silent: false }), signals, { urgent: { problem: "not_identified", question: null } });
  }
  const added: DoubtReason = { kind: "added_by_reference", quantity: quantity as PositiveInteger, quote: null };
  if (resolution.kind === "between") return checked(said, doubtfulDraft(said.request, resolution.productIds, quantity, snapshot), signalsOf(said, "named", { candidates: "several" }),
    { doubt: added, urgent: { problem: "not_clear", question: whichProduct(resolution.productIds, snapshot) } });
  const product = snapshot.products.find((candidate) => candidate.productId === resolution.productId);
  if (!product) return checked(said, report({ kind: "not_identified", source: "text", identification: null, silent: false }), signals, { urgent: { problem: "not_identified", question: null } });
  if (snapshot.messageKind === "photo_product" && !product.shown) return checked(said, invalid("not_the_shown_product"), signals, { urgent: { problem: "invalid_action", question: null } });
  const choices = resolution.values.map((entry): AttributeChoice => ({ name: entry.attribute, value: entry.value }));
  return withProduct(said, env, product, choices, quantity, signals, added);
}

function checkShown(said: Said, env: Env, quantity: number): readonly CheckedAction[] {
  const shown = env.snapshot.products.filter((product) => product.shown);
  if (shown.length === 0) {
    return [checked(said, report({ kind: "not_identified", source: "photo", identification: null, silent: false }), signalsOf(said, "photo_same_message"), { urgent: { problem: "not_identified", question: null } })];
  }
  const added: DoubtReason = { kind: "added_by_reference", quantity: quantity as PositiveInteger, quote: null };
  return shown.map((product) => withProduct(said, env, product, [...qrChoices(product), ...choicesFromWords(product, said.request.values)], quantity, signalsOf(said, "photo_same_message"), added));
}

const whichProduct = (productIds: readonly ProductId[], snapshot: CheckSnapshot): SuggestedQuestion | null => {
  const products = productIds.flatMap((productId) => snapshot.products.find((product) => product.productId === productId)?.name ?? []);
  return products.length >= 2 && products.length <= maxPendingCandidates ? { language: snapshot.language, kind: "which_product", products } : null;
};

/** Two to four candidates the resolution could not tell apart; only the values every candidate offers are kept. */
function doubtfulDraft(request: ExtractedRequest, productIds: readonly ProductId[], quantity: number, snapshot: CheckSnapshot): ResolvedChatAction {
  const products = productIds.flatMap((productId) => snapshot.products.find((product) => product.productId === productId) ?? []).slice(0, maxPendingCandidates);
  const [first] = products;
  if (!first || products.length < 2) return report({ kind: "not_identified", source: "text", identification: null, silent: false });
  const offered = (product: CheckProduct, choice: AttributeChoice) => product.attributes.find((attribute) => normalizeValue(attribute.name) === normalizeValue(choice.name))
    ?.values.find((value) => normalizeValue(value) === normalizeValue(choice.value));
  const known: Record<string, string> = {};
  for (const choice of choicesFromWords(first, request.values)) {
    const attribute = first.attributes.find((candidate) => normalizeValue(candidate.name) === normalizeValue(choice.name));
    const value = offered(first, choice);
    if (attribute && value !== undefined && products.every((product) => offered(product, choice) !== undefined)) known[attribute.name] = value;
  }
  const candidates = products.map((product) => product.productId) as unknown as readonly [ProductId, ProductId, ...ProductId[]];
  const stated = request.price ? statedOf(request.price) : null;
  return { kind: "draft_pending", draft: { subject: { kind: "product", candidates }, known, quantity, price: stated ? pendingPriceOf(stated, quantity, first) : null, problem: "not_clear", identification: null } };
}

/** The action for a product: an item, a pending it advances, a new pending, or the reason it cannot be either. */
function withProduct(said: Said, env: Env, product: CheckProduct, choices: readonly AttributeChoice[], quantity: number, signals: CertaintySignals, doubt: DoubtReason): CheckedAction {
  const { request } = said;
  const stated = request.price ? statedOf(request.price) : null;
  if (!product.sellable) return checked(said, report({ kind: "product_not_available", productId: product.productId }), signals, { urgent: { problem: "product_not_available", question: null } });
  const identification = identificationOf(product);
  const resolution = resolveVariant(product, {}, choices);
  const fresh: ResolvedChatAction = resolution.kind === "resolved"
    ? { kind: "add", item: resolution.item, quantity: quantity as PositiveInteger, mentionedPrice: stated ? mentionedPriceOf(stated, quantity, resolution.item.unitPrice) : null, identification }
    : { kind: "draft_pending", draft: { subject: { kind: "variant", productId: product.productId }, known: resolution.known, quantity, price: stated ? pendingPriceOf(stated, quantity, product) : null,
      problem: resolution.kind === "open" ? "variant_missing" : "variant_not_available", identification } };
  const urgent = resolution.kind === "resolved" ? null : variantProblem(product, resolution.kind === "open" ? "variant_missing" : "variant_not_available", resolution.known, choices, env.snapshot.language);
  const matched = matchPendings(product, choices, env.snapshot);
  if (matched.kind === "several") return checked(said, report({ kind: "variant_for_several_pendings", ...describePendings(matched.pendings) }), signals, { urgent: { problem: "variant_for_several_pendings", question: null } });
  if (matched.kind === "none") return checked(said, fresh, signals, { doubt, urgent });
  const shared = (env.claims.get(matched.pending.id) ?? 0) > 1;
  const advance: AdvanceRequest = { pendingId: matched.pending.id, mode: shared ? "assign" : "total", product, productId: product.productId, identification, values: choices,
    quantity: shared ? quantity : request.quantity?.value ?? null, price: stated };
  return checked(said, { kind: "advance_pending", request: advance, otherwise: fresh }, signals, { doubt, urgent });
}

type PendingMatch = Readonly<{ kind: "none" }> | Readonly<{ kind: "one"; pending: ChatPending }> | Readonly<{ kind: "several"; pendings: readonly ChatPending[] }>;

/** Pendings of a product: its variant pendings and the doubtful ones that list it. */
function matchPendings(product: CheckProduct, choices: readonly AttributeChoice[], snapshot: CheckSnapshot): PendingMatch {
  const mine = snapshot.pendings.map((entry) => entry.pending)
    .filter((pending) => (pending.subject.kind === "variant" ? pending.subject.productId === product.productId : pending.subject.candidates.includes(product.productId)));
  const [only, ...others] = mine;
  if (!only) return { kind: "none" };
  if (others.length === 0) return { kind: "one", pending: only };
  const fitting = mine.filter((pending) => !conflictsWithKnown(pending.known, choices));
  const [fit, ...moreFitting] = fitting;
  if (fit && moreFitting.length === 0) return { kind: "one", pending: fit };
  if (fit) return { kind: "several", pendings: fitting };
  return { kind: "one", pending: mine.reduce((latest, pending) => (pending.lastChangedAt.getTime() >= latest.lastChangedAt.getTime() ? pending : latest)) };
}

/** The pending a request claims, for the rule that requests sharing a pending assign one unit each. */
function claimedPending(request: ExtractedRequest, snapshot: CheckSnapshot): string | null {
  if (request.kind === "complete_pending" && request.target.kind === "pending") {
    const ref = request.target.ref;
    return snapshot.pendings.find((entry) => entry.ref === ref)?.pending.id ?? null;
  }
  return null;
}

// ---- pendings ----

function checkComplete(said: Said, env: Env): CheckedAction {
  const { request } = said;
  const { snapshot } = env;
  const signals = signalsOf(said, "named");
  const target = request.target;
  const pending = target.kind === "pending" ? snapshot.pendings.find((entry) => entry.ref === target.ref)?.pending : undefined;
  if (!pending) return checked(said, invalid("unknown_reference"), signals, { urgent: { problem: "invalid_action", question: null } });
  if (!whole(request.quantity?.value, 1)) return checked(said, invalid("quantity_not_whole"), signals, { urgent: { problem: "invalid_action", question: null } });
  const { subject } = pending;
  const present = subject.kind === "variant"
    ? snapshot.products.filter((product) => product.productId === subject.productId)
    : snapshot.products.filter((product) => subject.candidates.includes(product.productId));
  const [product, ...rest] = present;
  if (rest.length > 0) return problem(said, { kind: "variant_only" }, "variant_only", null, "named");
  const productId = product?.productId ?? (subject.kind === "variant" ? subject.productId : subject.candidates[0]);
  const values = product ? choicesFromWords(product, request.values) : [];
  const shared = (env.claims.get(pending.id) ?? 0) > 1;
  const advance: AdvanceRequest = { pendingId: pending.id, mode: "assign", product: product ?? null, productId, identification: product ? identificationOf(product) : textIdentification(productId),
    values, quantity: shared ? request.quantity?.value ?? 1 : request.quantity?.value ?? null, price: request.price ? statedOf(request.price) : null };
  const doubt: DoubtReason | null = request.quantity ? { kind: "quantity_set", quantity: request.quantity.value as PositiveInteger } : null;
  return checked(said, { kind: "advance_pending", request: advance, otherwise: report({ kind: "variant_only" }) }, signals, { doubt });
}

function checkDecline(said: Said, env: Env): CheckedAction {
  const { target } = said.request;
  const { snapshot } = env;
  const signals = signalsOf(said, "named");
  const { photoJustSent: left } = snapshot;
  const pending = target.kind === "pending" ? snapshot.pendings.find((entry) => entry.ref === target.ref)?.pending
    : left?.kind === "pending" ? snapshot.pendings.find((entry) => entry.pending.id === left.pendingId)?.pending : undefined;
  if (!pending) return checked(said, report({ kind: "no_intent" }), signals);
  return checked(said, { kind: "decline_pending", pendingId: pending.id }, signals);
}
