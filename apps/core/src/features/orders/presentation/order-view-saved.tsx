import type { ReactNode, RefObject } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { ChevronRight, Printer } from "lucide-react";
import type { OrderAggregateResponse } from "@shared/contracts/orders";
import { Alert, AlertDescription } from "@core/app/components/ui/alert";
import { Button } from "@core/app/components/ui/button";
import { PageHeader } from "@core/app/components/ui/page-header";
import { orderOriginKey, orderStatusLabels, OrderStatusIcon } from "@core/src/features/orders/presentation/order-status-labels";
import type { PaymentFormat } from "@core/src/features/orders/presentation/payment-row";

type Order = OrderAggregateResponse;

/** The status labels of the header: «Venta completada» or «Pedido cancelado» alone, or the payment and the delivery. The balance stays out; the sales list shows it. */
function HeaderLabels({ order }: Readonly<{ order: Order }>) {
  const { t, i18n } = useTranslation();
  const labels = orderStatusLabels({ ...order, balanceDue: { amount: 0, currency: order.total.currency } }, t, i18n.language);
  return <ul className="flex flex-wrap items-center gap-2">{labels.map((label) => <li key={label.kind}>
    <span role="group" aria-label={label.name} className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium"><OrderStatusIcon label={label} />{label.text}</span>
  </li>)}</ul>;
}

export type SavedHeaderProps = Readonly<{
  order: Order; salesHref: string; format: PaymentFormat; headerRef: RefObject<HTMLDivElement | null>;
  /** Unsaved edits of products, customer or delivery. */
  unsaved: boolean; busy: boolean; saving: boolean;
  onPrint: () => void; onDiscard: () => void; onSave: () => void;
}>;

/** «Pedido #N»: breadcrumb, status labels, origin subtitle and the actions. **Imprimir rótulo** waits for the saved order, like the other actions that read it. */
export function SavedHeader({ order, salesHref, format, headerRef, unsaved, busy, saving, onPrint, onDiscard, onSave }: SavedHeaderProps) {
  const { t } = useTranslation();
  const title = t("orders.orderNumber", { number: order.number });
  const subtitle = [t("orderView.header.createdOn", { date: format.date(order.createdAt) }), t(orderOriginKey(order.source)),
    ...(order.completedAt ? [t("orderView.header.completedOn", { date: format.date(order.completedAt) })] : [])].join(" · ");
  return <div ref={headerRef} className="flex flex-col gap-3">
    <nav aria-label={t("orderView.header.breadcrumb")}>
      <ol className="flex items-center gap-1 text-sm text-muted-foreground">
        <li><Link to={salesHref} className="inline-flex min-h-touch items-center hover:underline">{t("orderView.header.sales")}</Link></li>
        <li aria-hidden="true"><ChevronRight className="size-icon-inline" /></li>
        <li aria-current="page" className="text-foreground">{title}</li>
      </ol>
    </nav>
    <PageHeader>
      <PageHeader.Heading>
        <PageHeader.Title id="order-view-title" tabIndex={-1} className="outline-none">{title}</PageHeader.Title>
        <HeaderLabels order={order} />
        <PageHeader.Description>{subtitle}</PageHeader.Description>
      </PageHeader.Heading>
      <PageHeader.Actions>
        {unsaved && !order.cancelled && <p className="basis-full text-sm text-muted-foreground xl:basis-auto xl:self-center">{t("orderView.status.unsavedChanges")} {t("orderView.status.saveFirst")}</p>}
        <PrintButton blocked={unsaved} onPrint={onPrint} />
        <Button asChild variant="ghost" className="text-muted-foreground"><Link to={salesHref}>{t("orderView.header.viewSales")}</Link></Button>
        {!order.cancelled && <>
          <Button type="button" variant="outline" disabled={!unsaved || busy} onClick={onDiscard}>{t("orderView.header.discardChanges")}</Button>
          <Button type="button" disabled={!unsaved || busy} aria-busy={saving || undefined} onClick={onSave}>{t(saving ? "orderView.header.saving" : "orderView.header.saveChanges")}</Button>
        </>}
      </PageHeader.Actions>
    </PageHeader>
  </div>;
}

function PrintButton({ blocked, onPrint }: Readonly<{ blocked: boolean; onPrint: () => void }>) {
  const { t } = useTranslation();
  return <>
    <Button type="button" variant="outline" aria-disabled={blocked || undefined} aria-describedby={blocked ? "print-blocked-note" : undefined} onClick={() => { if (!blocked) onPrint(); }}>
      <Printer data-icon="inline-start" aria-hidden="true" />{t("dispatchLabels.print")}</Button>
    {blocked && <span id="print-blocked-note" className="sr-only">{t("orderView.status.saveFirst")}</span>}
  </>;
}

/** The alerts under the header that only a saved order has: the conflict, the products reset by a deduction, the order that moved on, and the result of the last save. */
export function SavedNotices({ notice, order, hasCustomerEdit, hasOtherEdit, onReload, onSaveCustomerOnly, alertRef }: Readonly<{
  notice: Readonly<{ kind: "success"; text: string }> | Readonly<{ kind: "conflict" }> | Readonly<{ kind: "locked"; code: "DELIVERY_LOCKED" | "ORDER_CANCELLED" }> | Readonly<{ kind: "itemsLocked" }>;
  order: Order; hasCustomerEdit: boolean; hasOtherEdit: boolean; onReload: () => void; onSaveCustomerOnly: () => void; alertRef: RefObject<HTMLDivElement | null>;
}>): ReactNode {
  const { t } = useTranslation();
  if (notice.kind === "success") return <p role="status" className="text-sm text-[var(--success)]">{notice.text}</p>;
  const lockedText = notice.kind === "locked" ? t(`orderView.failure.${notice.code === "ORDER_CANCELLED" || order.cancelled ? "cancelled" : order.deliveryStatus === "delivered" ? "delivered" : "shipped"}`) : null;
  const text = notice.kind === "conflict" ? t("orderView.failure.conflict")
    : notice.kind === "itemsLocked" ? t(hasOtherEdit ? "orderView.failure.stockDeducted" : "orderView.failure.stockDeductedAlone") : lockedText;
  return <Alert ref={alertRef} role="alert" variant="destructive" tabIndex={-1} className="outline-none">
    <AlertDescription className="flex flex-wrap items-center gap-3">
      <span>{text}</span>
      {(notice.kind === "conflict" || notice.kind === "locked") && <Button type="button" variant="outline" onClick={onReload}>{t("orderView.failure.reload")}</Button>}
      {notice.kind === "locked" && notice.code === "DELIVERY_LOCKED" && !order.cancelled && hasCustomerEdit
        && <Button type="button" variant="outline" onClick={onSaveCustomerOnly}>{t("orderView.failure.saveOnlyCustomer")}</Button>}
    </AlertDescription>
  </Alert>;
}
