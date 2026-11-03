import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

/** «Con duda» with its reason: text and icon, never color alone. The amber of the short-stock notice, which meets 4.5:1 in light and dark. */
export function DoubtMark({ reasons, quote }: Readonly<{ reasons: readonly string[]; quote?: string | null }>) {
  const { t } = useTranslation();
  return <div className="grid gap-0.5 text-sm text-[var(--warning)]" data-testid="doubt-mark">
    <p className="flex items-center gap-1.5 font-medium"><TriangleAlert className="size-4 shrink-0" aria-hidden="true" />{t("orderReview.mark")}</p>
    {reasons.map((reason) => <p key={reason}>{reason}</p>)}
    {quote && <p className="italic text-muted-foreground">{t("orderReview.quote", { quote: `“${quote}”` })}</p>}
  </div>;
}
