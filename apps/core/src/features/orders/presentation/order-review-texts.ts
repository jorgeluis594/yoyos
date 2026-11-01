import type { TFunction } from "i18next";
import type { OrderReviewResponse } from "@shared/contracts/order-review";

type Review = OrderReviewResponse;
export type ReviewChange = Review["messageRows"][number]["changes"][number];
export type ReviewLine = NonNullable<ReviewChange["before"]>;
export type ReviewPoint = Review["points"][number];
export type ReviewDoubtReason = Extract<ReviewChange["decision"], { kind: "doubtful" }>["reason"];
export type ReviewMoney = (amount: number, currency: string) => string;

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
export const lineVariant = (line: Pick<ReviewLine, "variantAttributes">) => Object.values(line.variantAttributes).join(" · ");

/** «Gorra trucker · Negro · ×2»: the name, the variant values when it has any, and the units. */
export function lineLabel(line: ReviewLine, t: TFunction): string {
  const variant = lineVariant(line);
  return variant ? t("orderReview.line", { name: line.productName, variant, quantity: line.quantity }) : t("orderReview.lineUnique", { name: line.productName, quantity: line.quantity });
}

/** The name with its variant, for accessible names: «Polera gris M». */
export const lineName = (line: Pick<ReviewLine, "productName" | "variantAttributes">) => [line.productName, lineVariant(line)].filter(Boolean).join(" ");

export function reasonText(reason: ReviewDoubtReason, t: TFunction, money: ReviewMoney, currency: string): string {
  switch (reason.kind) {
    case "variant_changed": return t("orderReview.reason.variant_changed", { attribute: reason.attribute.toLowerCase(), from: reason.from, to: reason.to });
    case "quantity_set": return t("orderReview.reason.quantity_set", { count: reason.quantity });
    case "added_by_reference": return t("orderReview.reason.added_by_reference", { count: reason.quantity });
    case "removed": return t("orderReview.reason.removed", { product: reason.product });
    case "price_noted": return t("orderReview.reason.price_noted", { count: reason.units, amount: money(reason.amount, currency) });
    case "caption_unread": return t("orderReview.reason.caption_unread");
    case "inherited": return t("orderReview.reason.inherited", { reason: reasonText(reason.from, t, money, currency) });
  }
}

/** The point's line as the web shows it; a missing product name falls back to a sentence without it. */
export function pointText(point: ReviewPoint, t: TFunction): string {
  const named = point.product !== null;
  return t(`orderReview.point.${point.kind}${named ? "" : "_unnamed"}`, { product: point.product ?? "", quantity: point.quantity, missing: point.missing.map((name) => name.toLowerCase()).join(", ") });
}

/** What changed in the variant, as «talla L»: the attributes whose value differs. */
function changedVariant(before: ReviewLine, after: ReviewLine): string {
  const differs = Object.entries(after.variantAttributes).filter(([name, value]) => before.variantAttributes[name] !== value);
  return (differs.length > 0 ? differs : Object.entries(after.variantAttributes)).map(([name, value]) => `${name.toLowerCase()} ${value}`).join(" · ");
}

type Pair = Readonly<{ before: ReviewLine | null; after: ReviewLine | null }>;
/** «Agregó Polo básico · M · ×2», one phrase per change. */
export function changeSummary(change: Pair & Readonly<{ kind: ReviewChange["kind"] }>, t: TFunction): string {
  const { before, after } = change;
  if (!before && after) return t("orderReview.changes.summary.added", { line: lineLabel(after, t) });
  if (before && !after) return t("orderReview.changes.summary.removed", { line: lineLabel(before, t) });
  if (!before || !after) return "";
  if (change.kind === "quantity_changed") return t("orderReview.changes.summary.quantity", { name: lineName(after), quantity: after.quantity });
  if (change.kind === "variant_changed") return t("orderReview.changes.summary.variant", { name: after.productName, variant: changedVariant(before, after) });
  return t("orderReview.changes.summary.price", { name: lineName(after) });
}

/** What the undo does to that change, for its confirmation: «Quitar Gorra trucker · Negro · ×2», «Volver Polera gris a talla L». */
export function undoStep(change: Pair & Readonly<{ kind: ReviewChange["kind"] }>, t: TFunction): string {
  const { before, after } = change;
  if (!before && after) return t("orderReview.changes.inverse.added", { line: lineLabel(after, t) });
  if (before && !after) return t("orderReview.changes.inverse.removed", { line: lineLabel(before, t) });
  if (!before || !after) return "";
  if (change.kind === "quantity_changed") return t("orderReview.changes.inverse.quantity", { name: lineName(before), quantity: before.quantity });
  if (change.kind === "variant_changed") return t("orderReview.changes.inverse.variant", { name: before.productName, variant: changedVariant(after, before) });
  return t("orderReview.changes.inverse.price", { name: lineName(before) });
}

type Pendings = Review["messageRows"][number]["pendings"];
type ReadonlyPendings = Readonly<{ back: readonly Pendings["back"][number][]; end: readonly Pendings["end"][number][] }>;
/** «Volverá: Falta la variante · Polo básico», «Terminará: Producto no claro»: the points an undo brings back and the ones it ends. */
export function pendingSteps(pendings: ReadonlyPendings, t: TFunction): string[] {
  const point = (label: Pendings["back"][number]) => [t(`orderReview.changes.pending.${label.kind}`), label.product].filter(Boolean).join(" · ");
  return [...pendings.back.map((label) => t("orderReview.changes.pending.back", { point: point(label) })), ...pendings.end.map((label) => t("orderReview.changes.pending.end", { point: point(label) }))];
}

/** One phrase for the whole message: «Agregó Polo básico · M · ×2 · Quitó Gorra trucker». */
export const messageSummary = (changes: readonly ReviewChange[], t: TFunction) => changes.map((change) => changeSummary(change, t)).filter(Boolean).join(" · ");

/** «Se agregó … mientras revisabas»: the sure changes that arrived meanwhile, with the confirmed total. */
export function meanwhileText(changes: readonly ReviewChange[], total: string, t: TFunction): string {
  return t("orderReview.meanwhile", { changes: changes.map((change) => lowerFirst(changeSummary(change, t))).filter(Boolean).join(", "), total });
}

/** «15:42» for a message of today and «30/10 15:42» for another day, in Lima time. */
export function rowTime(at: string, now: Date, locale: string): string {
  const zone = "America/Lima";
  const date = new Date(at);
  const clock = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: zone }).format(date);
  const day = (value: Date) => new Intl.DateTimeFormat("en-CA", { dateStyle: "short", timeZone: zone }).format(value);
  if (day(date) === day(now)) return clock;
  return `${new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", timeZone: zone }).format(date)} ${clock}`;
}

/** «1 cambio con duda · 2 por resolver»: the counts of the link card and of Revisar pedido, or null with neither. */
export function countsText(status: Readonly<{ doubtfulCount: number; pointCount: number }>, t: TFunction): string | null {
  const { doubtfulCount, pointCount } = status;
  if (doubtfulCount > 0 && pointCount > 0) return `${t("orderReview.card.changes", { count: doubtfulCount })} · ${t("orderReview.card.pointsShort", { count: pointCount })}`;
  if (doubtfulCount > 0) return t("orderReview.card.changes", { count: doubtfulCount });
  if (pointCount > 0) return t("orderReview.card.points", { count: pointCount });
  return null;
}
