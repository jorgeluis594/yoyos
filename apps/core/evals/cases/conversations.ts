import type { EvalCaseInput } from "@core/evals/cases/schema";
import { after } from "@core/evals/cases/builders";

/**
 * Conversation cases: one chat, 2 to 4 messages, with events between them. Written from the rules sheet (the closed product draft:
 * Rules, Pendings, Notices, That's all) by someone who does not tune; the wording is the buyer's own, never the draft's examples.
 *
 * Every step states the notice (`null` is silent) and the chat's latest order after the message. No order exists before the first
 * message: the earlier messages are the order. `kind` is the family of the conversation.
 */

type Variant = Readonly<Record<string, string>>;

const basicoL: Variant = { Talla: "L", Color: "Negro" };
const photo = (shows: string, caption?: string) => ({ photo: { shows }, ...(caption === undefined ? {} : { caption }) });
const text = (value: string) => ({ text: value });
const trucker = (color: "Negro" | "Rojo", quantity = 1) => after("gorra-trucker", { Color: color }, quantity);
const polo = (variant: Variant, quantity = 1) => after("polo-basico", variant, quantity);

const polera = (variant: Variant, quantity = 1) => after("polera-capucha", variant, quantity);
const snapback = (quantity = 1) => after("gorra-snapback", { Color: "Azul" }, quantity);
const chompaTejida = (quantity = 1) => after("chompa-tejida", { Talla: "Única" }, quantity);
const correaNegra = after("correa-cuero", { Color: "Negro" });
const gorraRojaOrder = trucker("Rojo");
const poloLine = { product: "polo-basico", variant: { Talla: "M", Color: "Negro" }, quantity: 1 };

/**
 * New dev conversations of «Message to order without silent losses», written from the closed product definition by someone who does not
 * tune. The eval conversation has no outgoing step, so «after a seller reply» is covered by T6's integration test, not here. Every id falls
 * in the dev split (cases/new-dev-cases.test.ts). `unnamed-wording` marks the messages that name no product, so T8 can scan the reader's
 * answers for a pending ref on them.
 */
export const newDevConversationCases: readonly EvalCaseInput[] = [
  // Quantity for the photo just sent. Rules «Quantity for the photo just sent».
  { id: "conv-photo-set-with-values", pass: "conversation", kind: "photo-quantity", tags: ["unnamed-wording"], steps: [
    { input: photo("polo-basico"), expected: { notice: "variant_missing", order: [] } },
    { input: text("quiero 3 de esos en M negro"), expected: { notice: null, order: [polo({ Talla: "M", Color: "Negro" }, 3)] } },
  ] },
  { id: "conv-photo-set-then-complete-other-only-item", pass: "conversation", kind: "photo-quantity", tags: ["unnamed-wording"],
    order: [{ product: "gorra-trucker", variant: { Color: "Negro" }, quantity: 1 }], steps: [
      { input: photo("polera-capucha"), expected: { notice: "variant_missing", order: [trucker("Negro")] } },
      { input: text("que sean 3"), expected: { notice: null, order: [trucker("Negro")] } },
      { input: text("gris M"), expected: { notice: null, order: [trucker("Negro"), polera({ Talla: "M", Color: "Gris" }, 3)] } },
    ] },
  { id: "conv-photo-set-grows-only-item", pass: "conversation", kind: "photo-quantity", tags: ["unnamed-wording"],
    order: [{ product: "gorra-snapback", variant: { Color: "Azul" }, quantity: 1 }], steps: [
      { input: photo("gorra-snapback"), expected: { notice: null, order: [snapback(2)] } },
      { input: text("quiero 3 de esas"), expected: { notice: null, order: [snapback(3)] } },
    ] },
  { id: "conv-photo-add-wording-grown-item", pass: "conversation", kind: "photo-quantity", tags: ["unnamed-wording"],
    order: [{ product: "gorra-snapback", variant: { Color: "Azul" }, quantity: 1 }], steps: [
      { input: photo("gorra-snapback"), expected: { notice: null, order: [snapback(2)] } },
      { input: text("otros 2"), expected: { notice: "unnamed_add", order: [snapback(2)] } },
    ] },
  { id: "conv-photo-set-new-single-variant", pass: "conversation", kind: "photo-quantity", tags: ["unnamed-wording"], steps: [
    { input: photo("chompa-tejida"), expected: { notice: null, order: [chompaTejida()] } },
    { input: text("pásame 3 de esas"), expected: { notice: null, order: [chompaTejida(3)] } },
  ] },
  { id: "conv-photo-set-above-99", pass: "conversation", kind: "photo-quantity", tags: ["unnamed-wording"], steps: [
    { input: photo("chompa-tejida"), expected: { notice: null, order: [chompaTejida()] } },
    { input: text("quiero 150 de esas"), expected: { notice: "quantity_above_limit", order: [chompaTejida()] } },
  ] },
  { id: "conv-photo-add-wording-pending", pass: "conversation", kind: "photo-quantity", tags: ["unnamed-wording"], steps: [
    { input: photo("polera-capucha"), expected: { notice: "variant_missing", order: [] } },
    { input: text("dame 2 más de esas"), expected: { notice: "unnamed_add", order: [] }, expectsRepeatNotice: true },
    { input: text("gris L"), expected: { notice: null, order: [polera({ Talla: "L", Color: "Gris" })] } },
  ] },
  { id: "conv-photo-after-thanks-set-b", pass: "conversation", kind: "photo-quantity", tags: ["unnamed-wording"], steps: [
    { input: photo("polo-premium"), expected: { notice: "variant_missing", order: [] } },
    { input: text("gracias, muy amable"), expected: { notice: null, order: [] } },
    { input: text("quiero 3 de esos"), expected: { notice: "unnamed_add", order: [] }, expectsRepeatNotice: true },
    { input: text("blanco L"), expected: { notice: null, order: [after("polo-premium", { Talla: "L", Color: "Blanco" })] } },
  ] },
  { id: "conv-photo-burst-set", pass: "conversation", kind: "photo-quantity", tags: ["unnamed-wording"], steps: [
    { input: photo("polo-rayas"), expected: { notice: "variant_missing", order: [] } },
    { input: photo("polera-cuello-redondo"), expected: { notice: "variant_missing", order: [] } },
    { input: text("pásame 2 de esos"), expected: { notice: "unnamed_add", order: [] }, expectsRepeatNotice: true },
    { input: text("el de rayas en M"), expected: { notice: null, order: [after("polo-rayas", { Talla: "M", Color: "Azul" })] } },
  ] },
  { id: "conv-photo-declined-caption-set-2", pass: "conversation", kind: "photo-quantity", tags: ["unnamed-wording"], steps: [
    { input: photo("polera-capucha", "no la quiero, gracias, solo mostraba"), expected: { notice: null, order: [] } },
    { input: text("dame 3 de ese"), expected: { notice: "unnamed_add", order: [] } },
  ] },
  { id: "conv-photo-no-intent-caption-pending-set", pass: "conversation", kind: "photo-quantity", tags: ["unnamed-wording"], steps: [
    { input: photo("polo-oversize", "uy qué buena onda"), expected: { notice: "variant_missing", order: [] } },
    { input: text("quiero 2 de esos en XL"), expected: { notice: null, order: [after("polo-oversize", { Talla: "XL", Color: "Verde" }, 2)] } },
  ] },

  // Payment request with a pending left. Rules «With a pending left»; criterion 34.
  { id: "conv-pay-pending-with-ready-then-complete-2", pass: "conversation", kind: "payment-with-pending", tags: [],
    order: [{ product: "gorra-trucker", variant: { Color: "Rojo" }, quantity: 1 }], steps: [
      { input: photo("polo-premium"), expected: { notice: "variant_missing", order: [gorraRojaOrder] } },
      { input: text("ya acabé con mi pedido, ¿a dónde te pago?"), expected: { notice: "payment_request", order: [gorraRojaOrder] } },
      { input: text("M blanco"), expected: { notice: "ready", order: [gorraRojaOrder, after("polo-premium", { Talla: "M", Color: "Blanco" })] } },
    ] },
  { id: "conv-pay-pending-alone-then-complete-2", pass: "conversation", kind: "payment-with-pending", tags: [],
    order: [{ product: "gorra-trucker", variant: { Color: "Rojo" }, quantity: 1 }], steps: [
      { input: photo("polera-capucha"), expected: { notice: "variant_missing", order: [gorraRojaOrder] } },
      { input: text("¿cómo te pago?"), expected: { notice: "payment_request", order: [gorraRojaOrder] } },
      { input: text("negra L"), expected: { notice: null, order: [gorraRojaOrder, polera({ Talla: "L", Color: "Negro" })] } },
    ] },
  { id: "conv-pay-pending-no-order", pass: "conversation", kind: "payment-with-pending", tags: [], steps: [
    { input: photo("polo-rayas"), expected: { notice: "variant_missing", order: [] } },
    { input: text("pásame tu número para yapearte"), expected: { notice: "payment_request", order: [] } },
    { input: text("S"), expected: { notice: null, order: [after("polo-rayas", { Talla: "S", Color: "Azul" })] } },
  ] },
  { id: "conv-pay-closed-then-new-order", pass: "conversation", kind: "payment-closed", tags: [],
    order: [poloLine], orderState: "closed", steps: [
      { input: text("mándame el enlace de pago"), expected: { notice: "payment_request", order: [polo({ Talla: "M", Color: "Negro" })] } },
      { input: text("y suma una gorra trucker en rojo, envíame el enlace"), expected: { notice: "payment_request", order: [gorraRojaOrder] } },
    ] },
  { id: "conv-ready-then-lower-last-pending-to-zero", pass: "conversation", kind: "pending-quantity", tags: [],
    order: [{ product: "correa-cuero", variant: { Color: "Negro" }, quantity: 1 }], steps: [
      { input: text("quiero 2 polos premium"), expected: { notice: "variant_missing", order: [correaNegra] } },
      { input: text("eso es todo"), expected: { notice: "ready_with_pendings", order: [correaNegra] }, expectsRepeatNotice: true },
      { input: text("quítale los 2 polos"), expected: { notice: "ready", order: [correaNegra] } },
    ] },

  // Quantity on a named pending. Rules «Quantity»; criterion 13.
  { id: "conv-pending-lower-by-one", pass: "conversation", kind: "pending-quantity", tags: [], steps: [
    { input: text("quiero 2 poleras con capucha"), expected: { notice: "variant_missing", order: [] } },
    { input: text("quítale una a la polera"), expected: { notice: null, order: [] } },
    { input: text("gris L"), expected: { notice: null, order: [polera({ Talla: "L", Color: "Gris" })] } },
  ] },
  { id: "conv-pending-lower-to-zero", pass: "conversation", kind: "pending-quantity", tags: [], steps: [
    { input: text("quiero 2 poleras con capucha"), expected: { notice: "variant_missing", order: [] } },
    { input: text("quítale las 2 poleras"), expected: { notice: null, order: [] } },
    { input: text("gris L"), expected: { notice: "variant_only", order: [] } },
  ] },
  { id: "conv-pending-set-by-name-2", pass: "conversation", kind: "pending-quantity", tags: [], steps: [
    { input: photo("polo-premium"), expected: { notice: "variant_missing", order: [] } },
    { input: text("del polo premium que sean 4"), expected: { notice: null, order: [] } },
    { input: text("negro M"), expected: { notice: null, order: [after("polo-premium", { Talla: "M", Color: "Negro" }, 4)] } },
  ] },

  // Declines. The WhatsApp test's F2 and cleanup: a named decline ends a pending left without an order; with no pending it is silent.
  { id: "conv-no-intent-caption-then-named-decline", pass: "conversation", kind: "decline", tags: [], steps: [
    { input: photo("polera-capucha", "me encanta"), expected: { notice: "variant_missing", order: [] } },
    { input: text("ya no quiero la polera con capucha"), expected: { notice: null, order: [] } },
    { input: text("ya no quiero la correa de cuero"), expected: { notice: null, order: [] } },
  ] },
  { id: "conv-named-decline-then-late-variant", pass: "conversation", kind: "decline", tags: [], steps: [
    { input: photo("polo-rayas", "se ve genial"), expected: { notice: "variant_missing", order: [] } },
    { input: text("ya no quiero el polo a rayas"), expected: { notice: null, order: [] } },
    { input: text("talla S"), expected: { notice: "variant_only", order: [] } },
  ] },

  // Product no longer sellable named in a text. Rules «Product no longer sellable named in a text».
  { id: "conv-named-deactivated-product-2", pass: "conversation", kind: "product-unavailable", tags: [], steps: [
    { input: text("quiero una chompa tejida"), expected: { notice: null, order: [chompaTejida()] } },
    { event: "deactivate_product", product: "polo-premium" },
    { input: text("quiero el polo premium blanco en L"), expected: { notice: "product_not_available", order: [chompaTejida()] } },
  ] },
  { id: "conv-named-deactivated-similar-active", pass: "conversation", kind: "product-unavailable", tags: [], steps: [
    { input: text("agrega una correa negra"), expected: { notice: null, order: [correaNegra] } },
    { event: "deactivate_product", product: "polo-oversize" },
    { input: text("quiero el polo oversize en XL"), expected: { notice: "product_not_available", order: [correaNegra] } },
  ] },

  // A change after a closed order. Rules «Notices»: the closed-order text (accepted by scoring when only the generic body ships).
  { id: "conv-change-after-confirmed-payment", pass: "conversation", kind: "closed-order", tags: [], steps: [
    { input: text("quiero un polo premium negro M"), expected: { notice: null, order: [after("polo-premium", { Talla: "M", Color: "Negro" })] } },
    { event: "confirm_payment" },
    { input: text("prefiero que sea talla L"), expected: { notice: "order_closed", order: [after("polo-premium", { Talla: "M", Color: "Negro" })] } },
  ] },
];

export const conversationCases: readonly EvalCaseInput[] = [
  // Photo then size. Rules: «Pendings» (what becomes a pending; completing), «Photos».
  { id: "conv-photo-oversize-then-size", pass: "conversation", kind: "photo-then-size", tags: [], steps: [
    { input: photo("polo-oversize"), expected: { notice: "variant_missing", order: [] } },
    { input: text("dámelo en la L"), expected: { notice: null, order: [after("polo-oversize", { Talla: "L", Color: "Verde" })] } },
  ] },
  { id: "conv-photo-capucha-then-both", pass: "conversation", kind: "photo-then-size", tags: [], steps: [
    { input: photo("polera-capucha"), expected: { notice: "variant_missing", order: [] } },
    { input: text("gris, talla L"), expected: { notice: null, order: [after("polera-capucha", { Talla: "L", Color: "Gris" })] } },
  ] },
  { id: "conv-photo-rayas-size-after-ask", pass: "conversation", kind: "photo-then-size", tags: [], steps: [
    { input: photo("polo-rayas"), expected: { notice: "variant_missing", order: [] } },
    { input: text("S nomás"), expected: { notice: null, order: [after("polo-rayas", { Talla: "S", Color: "Azul" })] } },
  ] },
  { id: "conv-text-pending-then-answer", pass: "conversation", kind: "text-then-size", tags: [], steps: [
    { input: text("reservame la polera con capucha"), expected: { notice: "variant_missing", order: [] } },
    { input: text("negra y que sea M"), expected: { notice: null, order: [after("polera-capucha", { Talla: "M", Color: "Negro" })] } },
  ] },

  // Partial completion: only part of what is missing arrives, no second notice. Rules: «Pendings» (partly completing).
  { id: "conv-premium-size-then-color", pass: "conversation", kind: "partial-completion", tags: [], steps: [
    { input: photo("polo-premium"), expected: { notice: "variant_missing", order: [] } },
    { input: text("L"), expected: { notice: null, order: [] } },
    { input: text("el blanco"), expected: { notice: null, order: [after("polo-premium", { Talla: "L", Color: "Blanco" })] } },
  ] },
  { id: "conv-capucha-color-then-size", pass: "conversation", kind: "partial-completion", tags: [], steps: [
    { input: photo("polera-capucha"), expected: { notice: "variant_missing", order: [] } },
    { input: text("la quiero gris"), expected: { notice: null, order: [] } },
    { input: text("talla M"), expected: { notice: null, order: [after("polera-capucha", { Talla: "M", Color: "Gris" })] } },
  ] },
  { id: "conv-two-units-split-between-variants", pass: "conversation", kind: "partial-completion", tags: [], steps: [
    { input: text("necesito dos polos básicos"), expected: { notice: "variant_missing", order: [] } },
    { input: text("el primero blanco S y el segundo negro L"), expected: { notice: null, order: [polo({ Talla: "S", Color: "Blanco" }), polo(basicoL)] } },
  ] },
  { id: "conv-two-units-one-assigned", pass: "conversation", kind: "partial-completion", tags: [], steps: [
    { input: text("quiero 2 polos básicos"), expected: { notice: "variant_missing", order: [] } },
    { input: text("uno solo por ahora: blanco M"), expected: { notice: null, order: [polo({ Talla: "M", Color: "Blanco" })] } },
    { input: text("para el que falta negro L"), expected: { notice: null, order: [polo({ Talla: "M", Color: "Blanco" }), polo(basicoL)] } },
  ] },

  // Replacement: a new message about the same product without its variant replaces the pending. Rules: «Pendings» (replacing).
  { id: "conv-photo-then-quantity-for-same", pass: "conversation", kind: "replacement", tags: [], steps: [
    { input: photo("polo-basico"), expected: { notice: "variant_missing", order: [] } },
    { input: text("oye mejor llévame 3 polos básicos"), expected: { notice: null, order: [] } },
    { input: text("negros M"), expected: { notice: null, order: [polo({ Talla: "M", Color: "Negro" }, 3)] } },
  ] },
  { id: "conv-replacement-names-missing-color", pass: "conversation", kind: "replacement", tags: [], steps: [
    { input: photo("polo-basico"), expected: { notice: "variant_missing", order: [] } },
    { input: text("polos básicos rojos, serían 2"), expected: { notice: "variant_not_available", order: [] }, expectsRepeatNotice: true },
    { input: text("ya pues blancos M"), expected: { notice: null, order: [polo({ Talla: "M", Color: "Blanco" }, 2)] } },
  ] },
  { id: "conv-unnamed-add-after-photo", pass: "conversation", kind: "replacement", tags: ["unnamed-wording"], steps: [
    // Relabeled by rule (product definition, «Quantity for the photo just sent»): set wording right after the photo sets what it left, without
    // notice, so the pending is ×3 and the color completes it with ×3. Not relabeled from any run.
    { input: photo("gorra-trucker"), expected: { notice: "variant_missing", order: [] } },
    { input: text("pásame 3 de esas"), expected: { notice: null, order: [] } },
    { input: text("en rojo"), expected: { notice: null, order: [trucker("Rojo", 3)] } },
  ] },
  { id: "conv-variant-not-available-then-other", pass: "conversation", kind: "replacement", tags: [], steps: [
    { input: text("polo básico en rojo talla M"), expected: { notice: "variant_not_available", order: [] } },
    { input: text("mejor de color blanco"), expected: { notice: null, order: [polo({ Talla: "M", Color: "Blanco" })] } },
  ] },

  // Decline: the buyer drops the pending, no notice, and a later size answers nothing. Rules: «Pendings» (discarding), «Variant-only text».
  { id: "conv-decline-then-late-size", pass: "conversation", kind: "decline", tags: [], steps: [
    { input: photo("polo-premium"), expected: { notice: "variant_missing", order: [] } },
    { input: text("no, déjalo, solo estaba mirando"), expected: { notice: null, order: [] } },
    { input: text("talla M"), expected: { notice: "variant_only", order: [] } },
  ] },
  { id: "conv-decline-and-order-other", pass: "conversation", kind: "decline", tags: [], steps: [
    { input: text("separame el polo básico"), expected: { notice: "variant_missing", order: [] } },
    { input: text("ese no, mejor la gorra trucker roja"), expected: { notice: null, order: [trucker("Rojo")] } },
  ] },

  { id: "conv-decline-trucker-then-color", pass: "conversation", kind: "decline", tags: [], steps: [
    { input: photo("gorra-trucker"), expected: { notice: "variant_missing", order: [] } },
    { input: text("no gracias, esa no"), expected: { notice: null, order: [] } },
    { input: text("de color rojo"), expected: { notice: "variant_only", order: [] } },
  ] },

  // Two pendings. Rules: «Pendings» (several pendings).
  { id: "conv-two-pendings-size-fits-both", pass: "conversation", kind: "two-pendings", tags: [], steps: [
    { input: photo("polo-basico"), expected: { notice: "variant_missing", order: [] } },
    { input: photo("polera-capucha"), expected: { notice: "variant_missing", order: [] } },
    { input: text("L"), expected: { notice: "variant_for_several_pendings", order: [] }, expectsRepeatNotice: true },
    { input: text("a las dos ponles talla L color negro"), expected: { notice: null, order: [polo(basicoL), after("polera-capucha", { Talla: "L", Color: "Negro" })] } },
  ] },
  { id: "conv-two-pendings-each-named", pass: "conversation", kind: "two-pendings", tags: [], steps: [
    { input: photo("polo-premium"), expected: { notice: "variant_missing", order: [] } },
    { input: photo("polera-capucha"), expected: { notice: "variant_missing", order: [] } },
    { input: text("el polo blanco M y la polera negra L"), expected: { notice: null,
      order: [after("polo-premium", { Talla: "M", Color: "Blanco" }), after("polera-capucha", { Talla: "L", Color: "Negro" })] } },
  ] },

  { id: "conv-two-pendings-both-polos", pass: "conversation", kind: "two-pendings", tags: [], steps: [
    { input: photo("polo-rayas"), expected: { notice: "variant_missing", order: [] } },
    { input: photo("polo-oversize"), expected: { notice: "variant_missing", order: [] } },
    { input: text("M"), expected: { notice: "variant_for_several_pendings", order: [] }, expectsRepeatNotice: true },
    { input: text("el de rayas en S y el oversize en XL"), expected: { notice: null,
      order: [after("polo-rayas", { Talla: "S", Color: "Azul" }), after("polo-oversize", { Talla: "XL", Color: "Verde" })] } },
  ] },

  // Doubtful product, then the choice. Rules: «Pendings» (what becomes a pending (b), partly completing).
  { id: "conv-gorra-doubt-then-choice", pass: "conversation", kind: "doubtful-then-choice", tags: [], steps: [
    { input: text("quiero una gorra"), expected: { notice: "not_clear", order: [] } },
    { input: text("la azul"), expected: { notice: null, order: [after("gorra-snapback", { Color: "Azul" })] } },
  ] },
  { id: "conv-polera-doubt-then-variant", pass: "conversation", kind: "doubtful-then-choice", tags: [], steps: [
    { input: text("me interesa una polera"), expected: { notice: "not_clear", order: [] } },
    { input: text("la de capucha"), expected: { notice: null, order: [] } },
    { input: text("negra M"), expected: { notice: null, order: [after("polera-capucha", { Talla: "M", Color: "Negro" })] } },
  ] },

  // Caption completing another product's pending. Rules: «Photos» (caption completing another pending).
  { id: "conv-caption-completes-polo-pending", pass: "conversation", kind: "caption-completes-pending", tags: [], steps: [
    { input: photo("polo-basico"), expected: { notice: "variant_missing", order: [] } },
    { input: photo("gorra-trucker", "esta rojita, y del polo me quedo con la M blanca"), expected: { notice: null, order: [trucker("Rojo"), polo({ Talla: "M", Color: "Blanco" })] } },
  ] },
  { id: "conv-caption-completes-capucha-pending", pass: "conversation", kind: "caption-completes-pending", tags: [], steps: [
    { input: photo("polera-capucha"), expected: { notice: "variant_missing", order: [] } },
    { input: photo("gorra-snapback", "dos de estas, y la polera va en L negra"), expected: { notice: null,
      order: [after("gorra-snapback", { Color: "Azul" }, 2), after("polera-capucha", { Talla: "L", Color: "Negro" })] } },
  ] },

  // A doubted caption on a photo that advances a pending: the seller gets the pending's notice again (rules sheet: accepted repeat).
  { id: "conv-doubted-caption-repeats-notice", pass: "conversation", kind: "caption-repeat-notice", tags: [], steps: [
    { input: photo("polo-basico"), expected: { notice: "variant_missing", order: [] } },
    { input: photo("polo-basico", "ese mismo, o el otro que te dije, bueno tú sabes"), expected: { notice: "variant_missing", order: [] }, expectsRepeatNotice: true },
    { input: text("blanco S"), expected: { notice: null, order: [polo({ Talla: "S", Color: "Blanco" })] } },
  ] },

  // A pending across an order closed by a reported payment. Rules: «Pendings» (ends with the order), «Open and closed orders».
  { id: "conv-pending-after-reported-payment", pass: "conversation", kind: "pending-after-payment", tags: [], steps: [
    { input: text("una correa de cuero marrón"), expected: { notice: null, order: [after("correa-cuero", { Color: "Marrón" })] } },
    { input: photo("polo-basico"), expected: { notice: "variant_missing", order: [after("correa-cuero", { Color: "Marrón" })] } },
    { event: "report_payment" },
    { input: text("talla M negro"), expected: { notice: "variant_only", order: [after("correa-cuero", { Color: "Marrón" })] } },
  ] },
  { id: "conv-pending-polera-after-payment", pass: "conversation", kind: "pending-after-payment", tags: [], steps: [
    { input: text("agrégame la chompa tejida"), expected: { notice: null, order: [after("chompa-tejida", { Talla: "Única" })] } },
    { input: text("también la polera cuello redondo"), expected: { notice: "variant_missing", order: [after("chompa-tejida", { Talla: "Única" })] } },
    { event: "report_payment" },
    { input: text("L"), expected: { notice: "variant_only", order: [after("chompa-tejida", { Talla: "Única" })] } },
  ] },

  // An orderless pending across an order another message created and closed. Rules: «Pendings» (without an open order; ends with the order).
  { id: "conv-orderless-pending-order-paid", pass: "conversation", kind: "orderless-pending-after-payment", tags: [], steps: [
    { input: photo("polo-premium"), expected: { notice: "variant_missing", order: [] } },
    { input: text("dame una gorra trucker negra"), expected: { notice: null, order: [trucker("Negro")] } },
    { event: "report_payment" },
    { input: text("L blanco"), expected: { notice: "variant_only", order: [trucker("Negro")] } },
  ] },
  { id: "conv-orderless-pending-order-paid-two", pass: "conversation", kind: "orderless-pending-after-payment", tags: [], steps: [
    { input: text("quiero la polera con capucha"), expected: { notice: "variant_missing", order: [] } },
    { input: text("sumo una correa negra"), expected: { notice: null, order: [after("correa-cuero", { Color: "Negro" })] } },
    { event: "report_payment" },
    { input: text("gris M"), expected: { notice: "variant_only", order: [after("correa-cuero", { Color: "Negro" })] } },
  ] },

  { id: "conv-orderless-pending-chompa-paid", pass: "conversation", kind: "orderless-pending-after-payment", tags: [], steps: [
    { input: photo("polera-cuello-redondo"), expected: { notice: "variant_missing", order: [] } },
    { input: text("una chompa tejida"), expected: { notice: null, order: [after("chompa-tejida", { Talla: "Única" })] } },
    { event: "report_payment" },
    { input: text("M"), expected: { notice: "variant_only", order: [after("chompa-tejida", { Talla: "Única" })] } },
  ] },

  // «listo» with a pending and its completion. Rules: «That's all».
  { id: "conv-ready-with-pending-then-complete", pass: "conversation", kind: "ready-with-pending", tags: [], steps: [
    { input: text("una correa negra por favor"), expected: { notice: null, order: [after("correa-cuero", { Color: "Negro" })] } },
    { input: photo("polera-capucha"), expected: { notice: "variant_missing", order: [after("correa-cuero", { Color: "Negro" })] } },
    { input: text("ya pedí todo lo que necesitaba"), expected: { notice: "ready_with_pendings", order: [after("correa-cuero", { Color: "Negro" })] }, expectsRepeatNotice: true },
    { input: text("gris L"), expected: { notice: "ready", order: [after("correa-cuero", { Color: "Negro" }), after("polera-capucha", { Talla: "L", Color: "Gris" })] } },
  ] },
  { id: "conv-ready-with-pending-then-decline", pass: "conversation", kind: "ready-with-pending", tags: [], steps: [
    { input: text("me llevo la chompa tejida"), expected: { notice: null, order: [after("chompa-tejida", { Talla: "Única" })] } },
    { input: photo("polo-basico"), expected: { notice: "variant_missing", order: [after("chompa-tejida", { Talla: "Única" })] } },
    { input: text("ya acabé de pedir"), expected: { notice: "ready_with_pendings", order: [after("chompa-tejida", { Talla: "Única" })] }, expectsRepeatNotice: true },
    { input: text("olvida ese polo, así dejémoslo"), expected: { notice: "ready", order: [after("chompa-tejida", { Talla: "Única" })] } },
  ] },
  { id: "conv-ready-then-new-request-drops-ready", pass: "conversation", kind: "ready-with-pending", tags: [], steps: [
    { input: photo("polo-basico"), expected: { notice: "variant_missing", order: [] } },
    { input: text("ya terminé mi pedido"), expected: { notice: "ready_with_pendings", order: [] }, expectsRepeatNotice: true },
    { input: text("y sumo una correa negra"), expected: { notice: null, order: [after("correa-cuero", { Color: "Negro" })] } },
    { input: text("el polo es blanco S"), expected: { notice: null, order: [after("correa-cuero", { Color: "Negro" }), polo({ Talla: "S", Color: "Blanco" })] } },
  ] },

  // Time: a pending without an order lasts 7 days from its last change. Rules: «Pendings» (without an open order).
  { id: "conv-pending-expires-without-order", pass: "conversation", kind: "pending-expiry", tags: [], steps: [
    { input: photo("polo-basico"), expected: { notice: "variant_missing", order: [] } },
    { event: "advance_days", days: 9 },
    { input: text("negro M"), expected: { notice: "variant_only", order: [] } },
  ] },
  { id: "conv-pending-kept-alive-by-partial-answer", pass: "conversation", kind: "pending-expiry", tags: [], steps: [
    { input: photo("polo-basico"), expected: { notice: "variant_missing", order: [] } },
    { event: "advance_days", days: 5 },
    { input: text("de talla S"), expected: { notice: null, order: [] } },
    { event: "advance_days", days: 5 },
    { input: text("blanco"), expected: { notice: null, order: [polo({ Talla: "S", Color: "Blanco" })] } },
  ] },

  // Product no longer sellable. Rules: «Pendings» (product or variant no longer sellable).
  { id: "conv-pending-product-deactivated", pass: "conversation", kind: "product-unavailable", tags: [], steps: [
    { input: text("quiero la polera con capucha"), expected: { notice: "variant_missing", order: [] } },
    { event: "deactivate_product", product: "polera-capucha" },
    { input: text("gris L"), expected: { notice: "product_not_available", order: [] } },
  ] },

  ...newDevConversationCases,
];
