import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { sellerNoticeDataSchema } from "@shared/contracts/seller-notices";
import type { OrderId } from "@core/src/features/orders/domain/order";
import type { ProductId } from "@core/src/features/products/domain/product";
import { sellerNoticeTarget, type SellerNotice } from "@core/src/features/orders/domain/seller-notice";
import { suggestedQuestionText } from "@core/src/features/orders/presentation/suggested-question-texts";
import type { NoticeContext, NoticeLocale, RenderedSellerNotice } from "@core/src/features/orders/application/describe-chat-message-notice";

type Text = Readonly<{ title: string; body: string }>;
/** The products of a list: up to three names and how many more there are, counting the ones with no name. */
type ProductList = Readonly<{ names: readonly string[]; more: number }>;
/** What a locale needs to write a notice; the cases that name an order have a variant for an order that no longer exists. */
type Texts = Readonly<{
  notRecognized: (source: "photo" | "text") => Text;
  notClear: (names: readonly string[], more: number) => Text;
  variantMissing: (name: string | null, attributes: readonly string[]) => Text;
  variantNotAvailable: (name: string | null) => Text;
  quantityAboveLimit: (name: string | null) => Text;
  unclearItem: (orderNumber: number | null) => Text;
  unnamedAdd: Text;
  variantOnly: Text;
  imageWithRequest: Text;
  orderClosed: (orderNumber: number | null) => Text;
  severalProblems: (count: number, names: readonly string[], more: number) => Text;
  failed: Text;
  onlyItemKept: (orderNumber: number | null) => Text;
  ready: (orderNumber: number | null) => Text;
  newOrder: (orderNumber: number | null, previous: number | null) => Text;
  notApplied: (orderNumber: number | null) => Text;
  paymentRequest: (order: "open" | "closed" | "none", orderNumber: number | null, missing: ProductList) => Text;
  orderChangedAfterLink: (orderNumber: number | null) => Text;
  changedAfterLink: string;
  productNotAvailable: (name: string | null) => Text;
  readyWithPendings: (orderNumber: number | null, missing: ProductList) => Text;
  variantForSeveralPendings: (missing: ProductList) => Text;
  newOrderNote: (orderNumber: number) => string;
}>;

const maxQuantity = 99;

const es: Texts = {
  notRecognized: (source) => ({ title: "Producto no reconocido", body: source === "photo"
    ? "Un cliente envió una foto que no coincide con tu catálogo. Revisa el chat."
    : "Un cliente pidió un producto que no encontramos en tu catálogo. Revisa el chat." }),
  notClear: (names, more) => ({ title: "Producto no claro", body: `Un cliente pidió un producto que coincide con varios de tu catálogo${names.length ? `: ${names.join(", ")}${more ? ` y ${more} más` : ""}` : ""}. Revisa el chat.` }),
  variantMissing: (name, attributes) => ({ title: "Falta la variante", body: `Un cliente pidió ${name ?? "un producto"} pero no dijo qué ${attributes.length ? attributes.join(" o ") : "variante"}. Revisa el chat.` }),
  variantNotAvailable: (name) => ({ title: "Variante no disponible", body: `Un cliente pidió una variante de ${name ?? "un producto"} que no existe o no está a la venta. Revisa el chat.` }),
  quantityAboveLimit: (name) => ({ title: "Revisa el chat", body: `Un cliente pidió más de ${maxQuantity} unidades de ${name ?? "un producto"}. No se agregaron.` }),
  unclearItem: (number) => ({ title: "Revisa el chat", body: number === null
    ? "Un cliente pidió quitar o cambiar un producto, pero no tiene un pedido abierto."
    : `Un cliente pidió quitar o cambiar un producto del pedido #${number}, pero no sabemos cuál.` }),
  unnamedAdd: { title: "Revisa el chat", body: "Un cliente pidió más de un producto sin decir cuál." },
  variantOnly: { title: "Revisa el chat", body: "Un cliente mencionó una variante sin decir qué producto cambiar." },
  imageWithRequest: { title: "Revisa el chat", body: "Un cliente envió una imagen que no es un producto y pidió algo en el texto." },
  orderClosed: (number) => ({ title: "Revisa el chat", body: number === null
    ? "Un cliente pidió cambiar un pedido que ya no se puede modificar."
    : `Un cliente pidió cambiar el pedido #${number}, que ya no se puede modificar.` }),
  severalProblems: (count, names, more) => ({ title: "Revisa el chat", body: `Un cliente pidió varias cosas y no pudimos aplicar ${count}${names.length ? `: ${joinList([...names, ...(more ? [more === 1 ? "otra" : `otras ${more}`] : [])], " y ")}` : ""}.` }),
  failed: { title: "No pudimos revisar un mensaje", body: "Un mensaje de un cliente no se pudo revisar. Revísalo en el chat." },
  onlyItemKept: (number) => ({ title: `Revisa el pedido${ref(number)}`, body: "Un cliente pidió quitar el único producto del pedido." }),
  ready: (number) => ({ title: number === null ? "Pedido listo" : `Pedido #${number} listo`, body: "Un cliente dice que terminó su pedido. Revísalo y obtén el enlace." }),
  newOrder: (number, previous) => ({ title: `Pedido nuevo${ref(number)}`, body: `Un cliente pidió más productos después de cerrar ${previous === null ? "el pedido anterior" : `el pedido #${previous}`}.` }),
  notApplied: (number) => ({ title: "Revisa el chat", body: number === null
    ? "Un cliente escribió algo que no pudimos aplicar a un pedido."
    : `Un cliente escribió algo sobre el pedido #${number} que no pudimos aplicar.` }),
  paymentRequest: (order, number, { names, more }) => {
    const missing = names.length ? listWithMore(names, more, " y ", (n) => `${n} más`) : more === 1 ? "un producto" : `${more} productos`;
    const title = "Revisa el chat";
    if (order === "closed") return { title, body: `Un cliente quiere pagar, pero el pedido${ref(number)} ya tiene un pago o está cerrado. Revisa el chat.` };
    if (names.length + more > 0) return { title, body: `Un cliente quiere pagar${number === null ? "" : ` el pedido #${number}`}, pero falta completar ${missing}.` };
    return { title, body: `Un cliente quiere pagar${number === null ? "" : ` el pedido #${number}`}.` };
  },
  orderChangedAfterLink: (number) => ({ title: `Pedido${ref(number)} cambió`, body: `Un cliente cambió el pedido${ref(number)} después de recibir el enlace. Revísalo antes de cobrar.` }),
  changedAfterLink: "El pedido cambió después de enviar el enlace.",
  productNotAvailable: (name) => ({ title: "Producto no disponible", body: `Un cliente pidió ${name === null ? "un producto" : name}${name === null ? "" : ","} que ya no está a la venta. Revisa el chat.` }),
  readyWithPendings: (number, { names, more }) => ({ title: "Revisa el chat", body: `Un cliente dice que terminó ${number === null ? "su pedido" : `el pedido #${number}`}, pero falta completar ${names.length ? listWithMore(names, more, " y ", (n) => `${n} más`) : more === 1 ? "un producto" : `${more} productos`}.` }),
  variantForSeveralPendings: ({ names, more }) => ({ title: "Revisa el chat", body: `Un cliente mencionó una variante sin decir de cuál ${names.length ? `producto: ${listWithMore(names, more, " y ", (n) => `${n} más`)}` : `de ${more} productos`}.` }),
  newOrderNote: (number) => `Se creó el pedido nuevo #${number}.`,
};

const pt: Texts = {
  notRecognized: (source) => ({ title: "Produto não reconhecido", body: source === "photo"
    ? "Um cliente enviou uma foto que não corresponde ao seu catálogo. Veja o chat."
    : "Um cliente pediu um produto que não encontramos no seu catálogo. Veja o chat." }),
  notClear: (names, more) => ({ title: "Produto não claro", body: `Um cliente pediu um produto que corresponde a vários do seu catálogo${names.length ? `: ${names.join(", ")}${more ? ` e mais ${more}` : ""}` : ""}. Veja o chat.` }),
  variantMissing: (name, attributes) => ({ title: "Falta a variante", body: `Um cliente pediu ${name ?? "um produto"} mas não disse qual ${attributes.length ? attributes.join(" ou ") : "variante"}. Veja o chat.` }),
  variantNotAvailable: (name) => ({ title: "Variante indisponível", body: `Um cliente pediu uma variante de ${name ?? "um produto"} que não existe ou não está à venda. Veja o chat.` }),
  quantityAboveLimit: (name) => ({ title: "Veja o chat", body: `Um cliente pediu mais de ${maxQuantity} unidades de ${name ?? "um produto"}. Nenhuma foi adicionada.` }),
  unclearItem: (number) => ({ title: "Veja o chat", body: number === null
    ? "Um cliente pediu para remover ou alterar um produto, mas não tem um pedido aberto."
    : `Um cliente pediu para remover ou alterar um produto do pedido #${number}, mas não sabemos qual.` }),
  unnamedAdd: { title: "Veja o chat", body: "Um cliente pediu mais de um produto sem dizer qual." },
  variantOnly: { title: "Veja o chat", body: "Um cliente mencionou uma variante sem dizer qual produto alterar." },
  imageWithRequest: { title: "Veja o chat", body: "Um cliente enviou uma imagem que não é um produto e pediu algo no texto." },
  orderClosed: (number) => ({ title: "Veja o chat", body: number === null
    ? "Um cliente pediu para alterar um pedido que não pode mais ser modificado."
    : `Um cliente pediu para alterar o pedido #${number}, que não pode mais ser modificado.` }),
  severalProblems: (count, names, more) => ({ title: "Veja o chat", body: `Um cliente pediu várias coisas e não conseguimos aplicar ${count}${names.length ? `: ${joinList([...names, ...(more ? [more === 1 ? "outra" : `outras ${more}`] : [])], " e ")}` : ""}.` }),
  failed: { title: "Não conseguimos revisar uma mensagem", body: "Uma mensagem de um cliente não pôde ser revisada. Veja no chat." },
  onlyItemKept: (number) => ({ title: `Revise o pedido${ref(number)}`, body: "Um cliente pediu para remover o único produto do pedido." }),
  ready: (number) => ({ title: number === null ? "Pedido pronto" : `Pedido #${number} pronto`, body: "Um cliente diz que terminou o pedido. Revise e obtenha o link." }),
  newOrder: (number, previous) => ({ title: `Novo pedido${ref(number)}`, body: `Um cliente pediu mais produtos depois do fechamento d${previous === null ? "o pedido anterior" : `o pedido #${previous}`}.` }),
  notApplied: (number) => ({ title: "Veja o chat", body: number === null
    ? "Um cliente escreveu algo que não conseguimos aplicar a um pedido."
    : `Um cliente escreveu algo sobre o pedido #${number} que não conseguimos aplicar.` }),
  paymentRequest: (order, number, { names, more }) => {
    const missing = names.length ? listWithMore(names, more, " e ", (n) => `mais ${n}`) : more === 1 ? "um produto" : `${more} produtos`;
    const title = "Veja o chat";
    if (order === "closed") return { title, body: `Um cliente quer pagar, mas o pedido${ref(number)} já tem um pagamento ou está fechado. Veja o chat.` };
    if (names.length + more > 0) return { title, body: `Um cliente quer pagar${number === null ? "" : ` o pedido #${number}`}, mas falta completar ${missing}.` };
    return { title, body: `Um cliente quer pagar${number === null ? "" : ` o pedido #${number}`}.` };
  },
  orderChangedAfterLink: (number) => ({ title: `Pedido${ref(number)} mudou`, body: `Um cliente mudou o pedido${ref(number)} depois de receber o link. Revise antes de cobrar.` }),
  changedAfterLink: "O pedido mudou depois de enviar o link.",
  productNotAvailable: (name) => ({ title: "Produto indisponível", body: `Um cliente pediu ${name ?? "um produto"}${name === null ? "" : ","} que não está mais à venda. Veja o chat.` }),
  readyWithPendings: (number, { names, more }) => ({ title: "Veja o chat", body: `Um cliente diz que terminou o pedido${number === null ? "" : ` #${number}`}, mas falta completar ${names.length ? listWithMore(names, more, " e ", (n) => `mais ${n}`) : more === 1 ? "um produto" : `${more} produtos`}.` }),
  variantForSeveralPendings: ({ names, more }) => ({ title: "Veja o chat", body: `Um cliente mencionou uma variante sem dizer de qual ${names.length ? `produto: ${listWithMore(names, more, " e ", (n) => `mais ${n}`)}` : `de ${more} produtos`}.` }),
  newOrderNote: (number) => `Foi criado o novo pedido #${number}.`,
};

const textsOf: Readonly<Record<NoticeLocale, Texts>> = { es, "pt-BR": pt };
const maxNamedProducts = 3;

function ref(number: number | null) { return number === null ? "" : ` #${number}`; }

/** «A», «A y B», «A, B y C». */
function joinList(items: readonly string[], conjunction: string) {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")}${conjunction}${items.at(-1)}`;
}

/** «A, B y C», or «A, B y 2 más» when names are left over: the rest is counted, never written. */
function listWithMore(names: readonly string[], more: number, conjunction: string, rest: (count: number) => string) {
  return more === 0 ? joinList(names, conjunction) : `${names.join(", ")}${conjunction}${rest(more)}`;
}

function textOf(notice: SellerNotice, texts: Texts, { names }: NoticeContext): Text {
  const orderNumber = (id: OrderId | null) => (id === null ? null : names.orderNumbers.get(id) ?? null);
  const product = (id: ProductId) => names.products.get(id);
  const productName = (id: ProductId) => product(id)?.name ?? null;
  const namesOf = (ids: readonly ProductId[]) => ids.flatMap((id) => productName(id) ?? []);
  /** Up to three names; pendings with no name (doubtful or deleted product) and the names past the third are counted. */
  const listOf = (ids: readonly ProductId[], unnamed: number): ProductList => {
    const named = namesOf(ids);
    return { names: named.slice(0, maxNamedProducts), more: unnamed + (ids.length - named.length) + Math.max(0, named.length - maxNamedProducts) };
  };
  switch (notice.kind) {
    case "not_identified": return texts.notRecognized(notice.source);
    case "not_clear": {
      const named = namesOf(notice.productIds);
      return texts.notClear(named.slice(0, maxNamedProducts), Math.max(0, named.length - maxNamedProducts));
    }
    case "variant_missing": return texts.variantMissing(productName(notice.productId), product(notice.productId)?.attributeNames ?? []);
    case "variant_not_available": return texts.variantNotAvailable(productName(notice.productId));
    case "quantity_above_limit": return texts.quantityAboveLimit(productName(notice.productId));
    case "unclear_item": return texts.unclearItem(orderNumber(notice.orderId));
    case "unnamed_add": return texts.unnamedAdd;
    case "variant_only": return texts.variantOnly;
    case "image_with_request": return texts.imageWithRequest;
    // «No open order» is the unclear item without an order to name.
    case "no_open_order": return texts.unclearItem(null);
    case "order_closed": return texts.orderClosed(orderNumber(notice.orderId));
    case "several_problems": {
      const named = namesOf(notice.productIds);
      return texts.severalProblems(notice.problemCount, named, notice.problemCount - named.length);
    }
    case "failed": return texts.failed;
    case "not_applied": return texts.notApplied(orderNumber(notice.orderId));
    case "payment_request": return texts.paymentRequest(notice.order.kind, notice.order.kind === "none" ? null : orderNumber(notice.order.orderId), listOf(notice.productIds, notice.unnamed));
    case "order_changed_after_link": return texts.orderChangedAfterLink(orderNumber(notice.orderId));
    case "product_not_available": return texts.productNotAvailable(notice.productId === null ? null : productName(notice.productId));
    case "ready_with_pendings": return texts.readyWithPendings(orderNumber(notice.orderId), listOf(notice.productIds, notice.unnamed));
    case "variant_for_several_pendings": return texts.variantForSeveralPendings(listOf(notice.productIds, notice.unnamed));
    case "only_item_kept": return texts.onlyItemKept(orderNumber(notice.orderId));
    case "ready": return texts.ready(orderNumber(notice.orderId));
    case "new_order": return texts.newOrder(orderNumber(notice.orderId), orderNumber(notice.previousOrderId));
  }
}

/** The texts of a notice in the device's language. A buyer's text, phone or WhatsApp id never reaches them. */
export function renderSellerNotice(notice: SellerNotice, locale: NoticeLocale, context: NoticeContext): Result<RenderedSellerNotice, Readonly<{ code: "INVALID_NOTICE_DATA"; message: string; retryable: false }>> {
  const texts = textsOf[locale];
  const { title, body: ownBody } = textOf(notice, texts, context);
  // The device's sentence about the link comes first; the question closes the body in the buyer's language.
  const suffixes = "changedAfterLink" in notice || "question" in notice
    ? [notice.changedAfterLink ? texts.changedAfterLink : null, notice.question ? suggestedQuestionText(notice.question) : null].flatMap((text) => text ?? [])
    : [];
  const body = [ownBody, ...suffixes].join(" ");
  const created = "newOrderId" in notice && notice.newOrderId ? context.names.orderNumbers.get(notice.newOrderId) : undefined;
  // The data is the contract the phone parses on tap: a payload that does not match is never sent.
  const data = sellerNoticeDataSchema.safeParse({ v: 1, companyId: context.companyId, messageId: context.messageId, target: sellerNoticeTarget(notice).kind });
  if (!data.success) return err({ code: "INVALID_NOTICE_DATA", message: "Invalid seller notice data", retryable: false });
  return ok({ title, body: created === undefined ? body : `${body} ${texts.newOrderNote(created)}`, data: data.data, groupKey: context.chatId });
}
