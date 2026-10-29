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
  { id: "conv-unnamed-add-after-photo", pass: "conversation", kind: "replacement", tags: [], steps: [
    { input: photo("gorra-trucker"), expected: { notice: "variant_missing", order: [] } },
    { input: text("pásame 3 de esas"), expected: { notice: "unnamed_add", order: [] }, expectsRepeatNotice: true },
    { input: text("en rojo"), expected: { notice: null, order: [trucker("Rojo")] } },
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
    { input: text("L"), expected: { notice: "variant_for_several_pendings", order: [] } },
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
    { input: text("M"), expected: { notice: "variant_for_several_pendings", order: [] } },
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
    { input: text("ya pedí todo lo que necesitaba"), expected: { notice: "ready_with_pendings", order: [after("correa-cuero", { Color: "Negro" })] } },
    { input: text("gris L"), expected: { notice: "ready", order: [after("correa-cuero", { Color: "Negro" }), after("polera-capucha", { Talla: "L", Color: "Gris" })] } },
  ] },
  { id: "conv-ready-with-pending-then-decline", pass: "conversation", kind: "ready-with-pending", tags: [], steps: [
    { input: text("me llevo la chompa tejida"), expected: { notice: null, order: [after("chompa-tejida", { Talla: "Única" })] } },
    { input: photo("polo-basico"), expected: { notice: "variant_missing", order: [after("chompa-tejida", { Talla: "Única" })] } },
    { input: text("ya acabé de pedir"), expected: { notice: "ready_with_pendings", order: [after("chompa-tejida", { Talla: "Única" })] } },
    { input: text("olvida ese polo, así dejémoslo"), expected: { notice: "ready", order: [after("chompa-tejida", { Talla: "Única" })] } },
  ] },
  { id: "conv-ready-then-new-request-drops-ready", pass: "conversation", kind: "ready-with-pending", tags: [], steps: [
    { input: photo("polo-basico"), expected: { notice: "variant_missing", order: [] } },
    { input: text("ya terminé mi pedido"), expected: { notice: "ready_with_pendings", order: [] } },
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
];
