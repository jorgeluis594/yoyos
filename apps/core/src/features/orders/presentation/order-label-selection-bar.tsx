import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Printer } from "lucide-react";
import { Button } from "@core/app/components/ui/button";
import { dispatchLabelMaxOrders } from "@shared/contracts/dispatch-labels";
import type { SelectionSummary } from "@core/src/features/orders/presentation/order-label-selection";

/** «3 pedidos seleccionados · 1 sin dirección no se imprimirá»; above the limit it explains the limit instead. */
export function selectionBarText(t: TFunction, language: string, summary: SelectionSummary): string {
  const selected = t("dispatchLabels.selected", { count: summary.total });
  if (summary.overLimit) return `${selected} · ${t("dispatchLabels.limit", { max: dispatchLabelMaxOrders })}`;
  const parts = [
    ...(summary.skipped.none ? [t("dispatchLabels.skipNone", { count: summary.skipped.none })] : []),
    ...(summary.skipped.pickup ? [t("dispatchLabels.skipPickup", { count: summary.skipped.pickup })] : []),
    ...(summary.skipped.cancelled ? [t("dispatchLabels.skipCancelled", { count: summary.skipped.cancelled })] : []),
  ];
  if (parts.length === 0) return selected;
  return `${selected} · ${new Intl.ListFormat(language === "pt" ? "pt" : "es", { style: "long", type: "conjunction" }).format(parts)} ${t("dispatchLabels.skipVerb", { count: summary.skippedTotal })}`;
}

type Props = Readonly<{ summary: SelectionSummary; onClear: () => void; onPrint: () => void }>;

export function OrderLabelSelectionBar({ summary, onClear, onPrint }: Props) {
  const { t, i18n } = useTranslation();
  const printable = summary.printableIds.length;
  return <div role="region" aria-label={t("dispatchLabels.bar")} className="fixed inset-x-0 bottom-0 z-40 border-t bg-card px-page-mobile py-3 shadow-lg md:left-sidebar sm:px-page-desktop">
    <div className="mx-auto flex max-w-content flex-wrap items-center justify-between gap-3">
      <p role="status" className="min-w-0 flex-1 basis-60 text-sm font-medium">{selectionBarText(t, i18n.language, summary)}</p>
      <div className="flex gap-2">
        <Button type="button" variant="outline" className="min-h-control max-md:min-h-touch" onClick={onClear}>{t("dispatchLabels.clear")}</Button>
        <Button type="button" className="min-h-control max-md:min-h-touch" disabled={printable === 0 || summary.overLimit} onClick={onPrint}><Printer data-icon="inline-start" aria-hidden="true" />{t("dispatchLabels.printMany", { count: printable })}</Button>
      </div>
    </div>
  </div>;
}
