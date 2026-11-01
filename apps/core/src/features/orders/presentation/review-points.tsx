import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy } from "lucide-react";
import type { OrderReviewResponse } from "@shared/contracts/order-review";
import { Button } from "@core/app/components/ui/button";
import { DoubtMark } from "@core/src/features/orders/presentation/doubt-mark";
import { pointText, reasonText, type ReviewMoney } from "@core/src/features/orders/presentation/order-review-texts";

const announcedForMs = 3000;

/** «Por resolver»: each point with what to do on the web and the question for the buyer, which the seller copies by hand. Informative: it blocks nothing. */
export function ReviewPoints({ points, money, currency }: Readonly<{ points: OrderReviewResponse["points"]; money: ReviewMoney; currency: string }>) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy(pendingId: string, question: string) {
    // A copy the browser refuses fails silently: the question stays selectable.
    try { await navigator.clipboard.writeText(question); } catch { return; }
    setCopied(pendingId);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), announcedForMs);
  }
  return <>
    <ul className="grid gap-4">{points.map((point) => <li key={`${point.pendingId}-${point.since}`} className="grid gap-2">
      <p className="font-medium">{pointText(point, t)}</p>
      {point.doubt && <DoubtMark reasons={[reasonText(point.doubt, t, money, currency)]} />}
      <p className="text-sm text-muted-foreground">{t("orderReview.point.howWeb")}</p>
      <div className="grid gap-1 rounded-md border bg-muted/40 p-3 text-sm">
        <p className="text-muted-foreground">{t("orderReview.point.ask")}</p>
        <p className="select-text">{point.question}</p>
        <Button type="button" variant="outline" size="sm" className="w-fit min-h-control max-md:min-h-touch"
          aria-label={point.product ? t("orderReview.point.copyAbout", { product: point.product }) : t("orderReview.point.copyUnnamed")} onClick={() => void copy(point.pendingId, point.question)}>
          <Copy data-icon="inline-start" aria-hidden="true" />{t("orderReview.point.copy")}</Button>
      </div>
    </li>)}</ul>
    <p role="status" aria-live="polite" className="text-sm text-muted-foreground">{copied ? t("orderReview.point.copied") : ""}</p>
  </>;
}
