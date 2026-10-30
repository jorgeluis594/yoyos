import { useTranslation } from "react-i18next";
import { Clock, ExternalLink } from "lucide-react";
import { formatReceiptDate, type PendingReceipt } from "@core/src/features/orders/presentation/buyer-checkout-screen";

/** What the buyer sees under the order title while a receipt waits for the seller: information, never approval. */
export function CheckoutClosingCard({ receipts }: Readonly<{ receipts: ReadonlyArray<PendingReceipt> }>) {
  const { t, i18n } = useTranslation();
  const dated = receipts.length > 1;
  // A single pending receipt without an image has nothing to show; with several, the dated line keeps it listed.
  const entries = dated ? receipts : receipts.filter((receipt) => receipt.url !== null);
  const label = (receipt: PendingReceipt) => dated ? t("buyerPaymentContent.viewReceiptAt", { date: formatReceiptDate(receipt.reportedAt, i18n.language) }) : t("buyerPaymentContent.viewReceipt");
  return <section data-store-part="status" className="mt-5 flex flex-col gap-2 rounded-[var(--radius-card)] border border-transparent bg-[var(--info-surface)] p-4 text-[var(--info)] sm:p-6">
    <h2 id="checkout-closing-title" tabIndex={-1} className="flex items-center gap-2 text-lg font-semibold"><Clock className="size-5" aria-hidden="true" />{t("buyerPaymentContent.closingTitle")}</h2>
    <p>{t("buyerPaymentContent.closingBody")}</p>
    <p>{t("buyerPaymentContent.closingHint")}</p>
    {entries.length > 0 && <ul className="flex flex-col">{entries.map((receipt) => <li key={receipt.id}>
      {receipt.url ? <a href={receipt.url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 min-w-11 items-center gap-2 font-medium underline underline-offset-4">
        <ExternalLink className="size-4 shrink-0" aria-hidden="true" /><span suppressHydrationWarning>{label(receipt)}</span><span className="sr-only">{t("buyerPaymentContent.opensInNewTab")}</span></a>
        : <span className="inline-flex min-h-11 items-center" suppressHydrationWarning>{label(receipt)}</span>}
    </li>)}</ul>}
  </section>;
}
