import type { TFunction } from "i18next";
import type { OrderReviewResponse } from "@shared/contracts/order-review";

type Review = OrderReviewResponse;
export type ReviewLine = Review["removedSinceLastReview"][number];
export type ReviewChange = Review["messageRows"][number]["changes"][number];
export type ReviewReason = Extract<ReviewChange["decision"], { kind: "doubtful" }>["reason"];
export type UndoRefusal = Extract<Review["messageRows"][number]["undo"], { kind: "refused" }>["reason"];

const variantOf = (line: ReviewLine) => Object.values(line.variantAttributes).join(" · ");

/** «Polera gris · M · ×1»: the copied name and attributes are the line's label. */
export function lineLabel(line: ReviewLine, t: TFunction, quantity = line.quantity): string {
  const variant = variantOf(line);
  return variant ? t("orderReview.line", { name: line.productName, variant, quantity }) : t("orderReview.lineNoVariant", { name: line.productName, quantity });
}

const nameWithVariant = (line: ReviewLine) => [line.productName, variantOf(line)].filter(Boolean).join(" · ");

/** «la talla» for the attributes with a known article; any other attribute reads bare. */
export function attributeText(attribute: string, t: TFunction): string {
  const articles = t("orderReview.articles", { returnObjects: true }) as unknown;
  const key = attribute.trim().toLowerCase();
  const article = articles && typeof articles === "object" ? (articles as Record<string, string>)[key] : undefined;
  return article ?? key;
}

export type ReasonContext = Readonly<{ t: TFunction; money: (amount: number) => string }>;

/** What the message did, in catalog terms. */
export function reasonText(reason: ReviewReason, { t, money }: ReasonContext): string {
  switch (reason.kind) {
    case "variant_changed": return t("orderReview.reasons.variant_changed", { attribute: attributeText(reason.attribute, t), from: reason.from, to: reason.to });
    case "quantity_set": return t("orderReview.reasons.quantity_set", { quantity: reason.quantity });
    case "added_by_reference": return t("orderReview.reasons.added_by_reference", { quantity: reason.quantity });
    case "removed": return t("orderReview.reasons.removed", { product: reason.product });
    case "price_noted": return t("orderReview.reasons.price_noted", { count: reason.units, amount: money(reason.amount) });
    case "caption_unread": return t("orderReview.reasons.caption_unread");
    case "inherited": return reasonText(reason.from, { t, money });
  }
}

const lowerFirst = (value: string) => value.charAt(0).toLowerCase() + value.slice(1);
const upperFirst = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

/** The reason a pending's doubt carries, as the «Por resolver» point shows it. */
export const pointDoubtText = (reason: ReviewReason, context: ReasonContext) => context.t("orderReview.pointDoubt", { reason: lowerFirst(reasonText(reason, context)) });

function changedAttribute(change: ReviewChange): { attribute: string; before: string; after: string } | null {
  if (!change.before || !change.after) return null;
  for (const [attribute, after] of Object.entries(change.after.variantAttributes)) {
    const before = change.before.variantAttributes[attribute];
    if (before !== after) return { attribute: attribute.toLowerCase(), before: before ?? "", after };
  }
  return null;
}

/** One change in the words of the «Cambios por mensajes» row: «agregó Polo básico · M · ×2». */
export function changeFragment(change: ReviewChange, t: TFunction): string {
  const line = change.after ?? change.before;
  if (!line) return "";
  switch (change.kind) {
    case "added": return t("orderReview.fragments.added", { line: lineLabel(line, t) });
    case "removed": return t("orderReview.fragments.removed", { line: lineLabel(line, t) });
    case "quantity_changed": return t("orderReview.fragments.quantity_changed", { name: nameWithVariant(line), quantity: line.quantity });
    case "variant_changed": {
      const changed = changedAttribute(change);
      return t("orderReview.fragments.variant_changed", { name: line.productName, attribute: changed?.attribute ?? "", value: changed?.after ?? variantOf(line) }).replace(/\s+/g, " ");
    }
    case "mentioned_price_set": return t("orderReview.fragments.mentioned_price_set", { name: nameWithVariant(line) });
  }
}

/** «Agregó Polo básico · M · ×2 · Quitó Gorra trucker». */
export const messageRowSummary = (changes: readonly ReviewChange[], t: TFunction) => changes.map((change) => upperFirst(changeFragment(change, t))).filter(Boolean).join(" · ");

/** «Se agregó … mientras revisabas»: the sure changes that arrived while the seller reviewed. */
export function meanwhileText(changes: readonly ReviewChange[], total: string, t: TFunction): string {
  const summary = changes.map((change) => changeFragment(change, t)).filter(Boolean).join(` ${t("listAnd")} `);
  return t("orderReview.meanwhile", { summary, total });
}

/** What undoing one change does, for the confirmation. */
export function undoConfirmationLines(changes: readonly ReviewChange[], t: TFunction): string[] {
  return changes.flatMap((change) => {
    const line = change.before ?? change.after;
    if (!line) return [];
    switch (change.kind) {
      case "added": return [t("orderReview.undoLines.added", { line: lineLabel(change.after ?? line, t) })];
      case "removed": return [t("orderReview.undoLines.removed", { line: lineLabel(line, t) })];
      case "quantity_changed": return [t("orderReview.undoLines.quantity_changed", { name: nameWithVariant(line), quantity: line.quantity })];
      case "variant_changed": {
        const changed = changedAttribute(change);
        return [t("orderReview.undoLines.variant_changed", { name: line.productName, attribute: changed?.attribute ?? "", value: changed?.before ?? variantOf(line) }).replace(/\s+/g, " ")];
      }
      case "mentioned_price_set": return [t("orderReview.undoLines.mentioned_price_set", { name: nameWithVariant(line) })];
    }
  });
}

/** Why a row cannot be undone; a product that is no longer sold is named when the row shows it. */
export function undoRefusalText(reason: UndoRefusal, changes: readonly ReviewChange[], t: TFunction): string {
  if (reason !== "not_sold") return t(`orderReview.undoRefused.${reason}`);
  const removed = changes.find((change) => change.kind === "removed" && change.before);
  return removed?.before ? t("orderReview.undoRefused.notSoldNamed", { name: nameWithVariant(removed.before) }) : t("orderReview.undoRefused.not_sold");
}

/** «1 cambio con duda · 2 por resolver», or null when there is nothing counted. */
export function countsText(status: Pick<Review["status"], "doubtfulCount" | "pointCount">, t: TFunction): string | null {
  const { doubtfulCount, pointCount } = status;
  if (doubtfulCount > 0 && pointCount > 0) return t("orderReview.countBoth", { doubts: t("orderReview.countDoubts", { count: doubtfulCount }), points: t("orderReview.countPointsShort", { count: pointCount }) });
  if (doubtfulCount > 0) return t("orderReview.countDoubts", { count: doubtfulCount });
  if (pointCount > 0) return t("orderReview.countPoints", { count: pointCount });
  return null;
}

const limaParts = (value: Date, locale: string) => Object.fromEntries(new Intl.DateTimeFormat(locale, { timeZone: "America/Lima", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
  .formatToParts(value).map((part) => [part.type, part.value]));

/** «15:42» for today (Lima), «30/10 15:42» for another day. */
export function rowTimeLabel(at: string, now: Date, locale: string): string {
  const row = limaParts(new Date(at), locale);
  const today = limaParts(now, locale);
  const time = `${row.hour}:${row.minute}`;
  return row.day === today.day && row.month === today.month ? time : `${row.day}/${row.month} ${time}`;
}

/** The marked changes of the review per order item: a mark is read as part of its item. */
export function doubtsByItem(review: Review): ReadonlyMap<string, readonly Review["doubtful"][number][]> {
  const byItem = new Map<string, Review["doubtful"][number][]>();
  for (const doubt of review.doubtful) {
    const itemId = doubt.change.after?.itemId;
    if (itemId) byItem.set(itemId, [...(byItem.get(itemId) ?? []), doubt]);
  }
  return byItem;
}
