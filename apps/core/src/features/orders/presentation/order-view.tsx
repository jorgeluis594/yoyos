import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";
import type { DeliverySettingsResponse } from "@shared/contracts/delivery-settings";
import { Alert, AlertDescription } from "@core/app/components/ui/alert";
import { Badge } from "@core/app/components/ui/badge";
import { Button } from "@core/app/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@core/app/components/ui/dialog";
import { PageHeader } from "@core/app/components/ui/page-header";
import { OrderLinkCard, orderLinkState, type OrderLink } from "@core/app/components/order-link-card";
import { formatCurrency } from "@core/app/format-currency";
import { cn } from "@core/app/lib/utils";
import { OrderCustomerCard, customerFieldId } from "@core/src/features/orders/presentation/order-customer-card";
import { OrderDeliveryCard } from "@core/src/features/orders/presentation/order-delivery-card";
import { OrderPaymentsPanel } from "@core/src/features/orders/presentation/order-payments-panel";
import { OrderProductsCard } from "@core/src/features/orders/presentation/order-products-card";
import type { PaymentDecisionResult } from "@core/src/features/orders/presentation/payment-decision-form";
import { touchTargets } from "@core/src/features/orders/presentation/touch-targets";
import { SavedHeader, SavedNotices } from "@core/src/features/orders/presentation/order-view-saved";
import type { PaymentFormat } from "@core/src/features/orders/presentation/payment-row";
import { useCatalogSearch } from "@core/src/features/orders/presentation/use-catalog-search";
import type { LeaveGuard } from "@core/src/features/orders/presentation/use-unsaved-changes-guard";
import {
  clearCustomer, customerRequired, estimate, invalidFields, isEmptyDraft, screenLocks, setCustomer, unsavedParts,
  type DeliveryDraft, type InvalidField, type OrderViewState,
} from "@core/src/features/orders/presentation/order-view-state";

/** What the status line says besides the invalid-fields alert: a refused save or the in-doubt check of a lost answer. */
export type ViewNotice =
  | Readonly<{ kind: "alert"; text: string; link?: Readonly<{ to: string; label: string }>; focus?: string }>
  | Readonly<{ kind: "doubt"; checking: boolean }>
  /** The result of the last save of a saved order, announced politely until the next edit. */
  | Readonly<{ kind: "success"; text: string }>
  /** A part changed elsewhere while the seller edited: the edits stay until **Recargar pedido**. */
  | Readonly<{ kind: "conflict" }>
  /** The order shipped, was delivered or was cancelled meanwhile; the text follows the order the view shows. */
  | Readonly<{ kind: "locked"; code: "DELIVERY_LOCKED" | "ORDER_CANCELLED" }>
  /** The stock was deducted meanwhile: the products went back to the saved ones. */
  | Readonly<{ kind: "itemsLocked" }>;

export type OrderViewLinks = Readonly<{ sales: string; deliverySettings: string; createProduct: string }>;

/** What a saved order adds to the view: the data its cards need and the actions the route owns. Absent on a new sale. */
export type SavedViewProps = Readonly<{
  link: OrderLink;
  receiptUrls: Record<string, string>;
  manualPaymentId: string;
  voidResult: PaymentDecisionResult | undefined;
  /** A payment, fulfillment or cancellation action is in flight or in doubt. */
  actionBusy: boolean;
  /** Under the header: the stock notice, **Cancelar pedido** and its messages. */
  underHeader: ReactNode;
  /** The «Estado del pedido» card, at the top of the right column. */
  statusCard: ReactNode;
  onPrint: () => void;
  /** **Descartar cambios**, once confirmed: the route returns every part to its pinned saved state. */
  onDiscardChanges: () => void;
  /** **Descartar y recargar**, once confirmed: the route loads the order again and pins every part. */
  onReload: () => void;
  /** **Guardar solo el cliente**: the route drops the other edits and saves the customer. */
  onSaveCustomerOnly: () => void;
}>;

export type OrderViewProps = Readonly<{
  /** Present for a saved order. */
  saved?: SavedViewProps;
  /** Each increment moves focus to the page heading: after a save lands. */
  headingFocus?: number;
  state: OrderViewState;
  onStateChange: (state: OrderViewState) => void;
  settings: DeliverySettingsResponse | null;
  links: OrderViewLinks;
  /** Drops the picker's cached empty search; the route bumps it after a save and after every loader revalidation. */
  catalogEpoch: number;
  guard: LeaveGuard;
  /** The creation request is in flight. */
  saving: boolean;
  notice: ViewNotice | null;
  /** Counts the saves the view refused for an invalid field: from the first one on the marks show, and each one moves focus to the first mark. */
  attempts: number;
  /** The variant that a save answered «ya no está disponible» for. */
  unavailableVariantId: string | null;
  /** Core answered that the payments do not cover «Marcar como entregado al guardar». */
  coverRequired: boolean;
  format: PaymentFormat;
  newPaymentId: () => string;
  onSave: () => void;
  onCheckAgain: () => void;
  /** **Descartar venta**, once confirmed: the route empties the view. */
  onDiscard?: () => void;
}>;

// ---------------------------------------------------------------------------------------------------------------------
// Invalid-field targets

/** The element a mark points at, for the alert link and for focus. */
export function markTargetId(mark: InvalidField): string | null {
  if (mark.section === "items") return mark.id ? `order-line-${mark.id}` : null;
  if (mark.section === "payments") return mark.id ? `payment-draft-${mark.id}` : null;
  if (mark.section === "customer") return customerFieldId(mark.field) ?? null;
  return mark.field === "tab" ? "order-delivery" : `order-delivery-${mark.field}`;
}

/** Moves focus to the control inside the target (a line or a payment row holds its input) and scrolls it into view. */
export function focusTarget(id: string): boolean {
  const target = document.getElementById(id);
  if (!target) return false;
  const direct = target.matches("input, select, textarea, button");
  const control = direct ? target : target.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea, [role=tab][aria-selected=true]") ?? target;
  control.focus();
  control.scrollIntoView?.({ block: "center" });
  return true;
}

const syntheticCoverMark: InvalidField = { section: "delivery", field: "deliverImmediately", reason: "deliver_needs_payment" };

// ---------------------------------------------------------------------------------------------------------------------

function useHeaderOutOfView() {
  const ref = useRef<HTMLDivElement>(null);
  const [outOfView, setOutOfView] = useState(false);
  useEffect(() => {
    const header = ref.current;
    if (!header || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setOutOfView(!entry!.isIntersecting));
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  return [ref, outOfView] as const;
}

/** Tailwind `xl` is 80rem: below it the sticky bar replaces the header actions. The server and the hydration pass render the wide layout. */
const narrowLayout = "(max-width: 79.99rem)";
function useNarrowLayout(): boolean {
  return useSyncExternalStore(
    (change) => { if (typeof matchMedia !== "function") return () => {}; const media = matchMedia(narrowLayout); media.addEventListener("change", change); return () => media.removeEventListener("change", change); },
    () => typeof matchMedia === "function" && matchMedia(narrowLayout).matches,
    () => false,
  );
}

const isTypingTarget = (target: EventTarget | null) =>
  target instanceof Element && target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='combobox'], [role='textbox']") !== null;

/** «/» opens the picker only outside a text field, with no dialog open, while the products can change. */
function useSlashShortcut(enabled: boolean, open: () => void) {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
      if (isTypingTarget(event.target) || document.querySelector("[role='dialog'], [role='alertdialog']")) return;
      event.preventDefault();
      open();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled, open]);
}

export function OrderView(props: OrderViewProps) {
  const { state, onStateChange: change, settings, links, guard, saving, notice, attempts, unavailableVariantId, coverRequired, format, saved } = props;
  const { t, i18n } = useTranslation();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [reloading, setReloading] = useState(false);
  const search = useCatalogSearch({ catalogEpoch: props.catalogEpoch });
  const [headerRef, headerOutOfView] = useHeaderOutOfView();
  const narrow = useNarrowLayout();
  const noticeRef = useRef<HTMLDivElement>(null);
  const firstMarkTarget = useRef<string | null>(null);
  const { draft } = state;
  const order = state.loaded?.order ?? null;
  const edits = unsavedParts(state);
  const unsaved = edits.length > 0;
  const inDoubt = notice?.kind === "doubt";
  const busy = saving || inDoubt || (saved?.actionBusy ?? false);
  const empty = isEmptyDraft(state);
  const productsEditable = screenLocks(state).products === null;
  const totals = estimate(state);
  const money = (amount: number, currency: string) => formatCurrency(amount, currency, i18n.language);

  const marks = attempts > 0 ? invalidFields(state) : [];
  const marksOf = (section: InvalidField["section"]) => marks.filter((mark) => mark.section === section);
  const deliveryMarks = [...marksOf("delivery"), ...(coverRequired && !marks.some((mark) => mark.reason === "deliver_needs_payment") ? [syntheticCoverMark] : [])];
  const firstMark = marks[0];
  const firstTarget = firstMark ? markTargetId(firstMark) : null;
  useEffect(() => { firstMarkTarget.current = firstTarget; });

  useSlashShortcut(productsEditable && !pickerOpen && !discarding && !reloading && !guard.blocked, () => setPickerOpen(true));

  // Each refused save moves focus to the first invalid field once its mark is on screen.
  useEffect(() => {
    if (attempts > 0 && firstMarkTarget.current) focusTarget(firstMarkTarget.current);
  }, [attempts]);
  // A refusal that names an element (an unavailable line, the delivery rate) or an alert takes focus when it appears.
  useEffect(() => {
    if (notice === null || !["alert", "conflict", "locked", "itemsLocked"].includes(notice.kind)) return;
    if (notice.kind === "alert" && notice.focus && focusTarget(notice.focus)) return;
    noticeRef.current?.focus();
  }, [notice]);
  // After a save lands the heading takes focus, so the new state is read from the top.
  const headingFocus = props.headingFocus ?? 0;
  useEffect(() => { if (headingFocus > 0) document.getElementById("order-view-title")?.focus(); }, [headingFocus]);

  const setDelivery = (delivery: DeliveryDraft) => change({ ...state, draft: { ...draft, delivery } });
  const total = totals.success ? money(totals.data.total.amount, totals.data.total.currency) : "—";
  const hasProducts = draft.items.length > 0;
  const canSave = !busy && (saved ? unsaved : hasProducts);
  const saveLabel = t(saving ? "orderView.header.saving" : saved ? "orderView.header.saveChanges" : "orderView.header.save");
  const zero = { amount: 0, currency: draft.currency };
  const paymentTotals = totals.success ? totals.data : { total: zero, paid: zero, balance: zero, excess: zero };
  const discardTitle = saved ? "orderView.discard.leaveTitle" : "orderView.discard.saleTitle";
  const discardConfirm = saved ? "orderView.discard.leaveConfirm" : "orderView.discard.saleConfirm";
  const stickyLabel = inDoubt ? "orderView.status.stickyVerifying" : notice?.kind === "success" ? "orderView.status.stickySaved" : saved && unsaved && !order?.cancelled ? "orderView.status.stickyUnsaved" : "orderView.products.total";
  const confirmDiscard = () => { setDiscarding(false); if (saved) saved.onDiscardChanges(); else props.onDiscard?.(); };
  // Below `xl`, the sticky bar already offers the save once the header has left the view: the header does not repeat it.
  const stickySaves = saved ? unsaved && !order?.cancelled : hasProducts;
  const headerSave = !(narrow && headerOutOfView && stickySaves);
  const stickyActions = saved ? unsaved && !order?.cancelled && <>
    <Button type="button" variant="outline" disabled={busy} onClick={() => setDiscarding(true)}>{t("orderView.header.discardChanges")}</Button>
    <Button type="button" disabled={!canSave} onClick={props.onSave}>{saveLabel}</Button></>
    : hasProducts && <Button type="button" disabled={!canSave} onClick={props.onSave}>{saveLabel}</Button>;

  return <section className={cn("flex flex-col gap-6 pb-24 xl:pb-0", touchTargets)} aria-labelledby="order-view-title">
    {saved && order ? <SavedHeader order={order} salesHref={links.sales} format={format} headerRef={headerRef} unsaved={unsaved} busy={busy} saving={saving} showSave={headerSave}
      onPrint={saved.onPrint} onDiscard={() => setDiscarding(true)} onSave={props.onSave} />
      : <div ref={headerRef} className="flex flex-col gap-3">
        <nav aria-label={t("orderView.header.breadcrumb")}>
          <ol className="flex items-center gap-1 text-sm text-muted-foreground">
            <li><Link to={links.sales} className="inline-flex min-h-touch items-center hover:underline">{t("orderView.header.sales")}</Link></li>
            <li aria-hidden="true"><ChevronRight className="size-icon-inline" /></li>
            <li aria-current="page" className="text-foreground">{t("orderView.header.newSale")}</li>
          </ol>
        </nav>
        <PageHeader>
          <PageHeader.Heading>
            <PageHeader.Title id="order-view-title" tabIndex={-1} className="outline-none">{t("orderView.header.newSale")}
              <Badge variant="outline" className="text-muted-foreground">{t("orderView.header.unsaved")}</Badge></PageHeader.Title>
            <PageHeader.Description>{t("orderView.header.newHint")}</PageHeader.Description>
          </PageHeader.Heading>
          <PageHeader.Actions>
            <Button asChild variant="ghost" className="text-muted-foreground"><Link to={links.sales}>{t("orderView.header.viewSales")}</Link></Button>
            <Button type="button" variant="outline" disabled={empty || busy} onClick={() => setDiscarding(true)}>{t("orderView.header.discard")}</Button>
            {headerSave && <Button type="button" disabled={!canSave} aria-busy={saving || undefined} onClick={props.onSave}>{saveLabel}</Button>}
          </PageHeader.Actions>
        </PageHeader>
      </div>}

    {saved?.underHeader}
    <div className="grid gap-2" data-testid="order-view-status">
      {notice?.kind === "doubt" && <div role="status" className="flex flex-wrap items-center gap-3 text-sm">
        <p>{t(notice.checking ? (saved ? "orderView.failure.changesInDoubt" : "orderView.failure.saleInDoubt") : "orderView.failure.checkFailed")}</p>
        {!notice.checking && <Button type="button" variant="outline" onClick={props.onCheckAgain}>{t("orderView.failure.checkAgain")}</Button>}
      </div>}
      {notice?.kind === "alert" && <Alert ref={noticeRef} variant="destructive" tabIndex={-1} className="outline-none">
        <AlertDescription>{notice.text}{notice.link && <> <Link to={notice.link.to} className="font-medium underline underline-offset-4">{notice.link.label}</Link></>}</AlertDescription></Alert>}
      {saved && order && notice && !(order.cancelled && notice.kind === "success") && (notice.kind === "success" || notice.kind === "conflict" || notice.kind === "locked" || notice.kind === "itemsLocked")
        && <SavedNotices notice={notice} order={order} hasCustomerEdit={edits.includes("customer")} hasOtherEdit={unsaved} alertRef={noticeRef}
          onReload={() => setReloading(true)} onSaveCustomerOnly={saved.onSaveCustomerOnly} />}
      {marks.length > 0 && <Alert variant="destructive"><AlertDescription>
        {firstTarget
          ? <a href={`#${firstTarget}`} onClick={(event) => { event.preventDefault(); focusTarget(firstTarget); }}>{t(marks.every((mark) => mark.section === "items") ? "orderView.status.productsInvalid" : "orderView.status.fieldsInvalid", { count: marks.length })}</a>
          : t("orderView.status.fieldsInvalid", { count: marks.length })}
      </AlertDescription></Alert>}
    </div>

    <div className="flex flex-col gap-6 xl:grid xl:grid-cols-[minmax(0,1.5fr)_minmax(22rem,1fr)] xl:items-start">
      <div className="flex min-w-0 flex-col gap-6 max-xl:contents">
        <div className="min-w-0 max-xl:order-1">
          <OrderProductsCard state={state} onChange={change} search={search} pickerOpen={pickerOpen} onPickerOpenChange={setPickerOpen}
            createProductHref={links.createProduct} unavailableVariantId={unavailableVariantId} />
        </div>
        <div className="min-w-0 max-xl:order-2">
          {saved && order
            ? <OrderPaymentsPanel mode="saved" order={order} receiptUrls={saved.receiptUrls} manualPaymentId={saved.manualPaymentId} voidResult={saved.voidResult}
              unsavedChanges={unsaved} hasProducts={hasProducts} busy={busy} format={format} />
            : <OrderPaymentsPanel mode="new" payments={draft.payments} onChange={(payments) => change({ ...state, draft: { ...draft, payments } })}
              estimate={paymentTotals} newPaymentId={props.newPaymentId} invalidPaymentIds={marksOf("payments").flatMap((mark) => mark.id ? [mark.id] : [])}
              hasProducts={hasProducts} busy={busy} format={format} />}
        </div>
        <OrderCustomerCard customer={draft.customer} source={order?.source ?? "manual"} locked={screenLocks(state).customer !== null} required={customerRequired(state)} marks={marksOf("customer")}
          onChange={(customer) => change(setCustomer(state, customer))} onRemove={() => change(clearCustomer(state))} />
      </div>
      <div className="flex min-w-0 flex-col gap-6 max-xl:contents">
        {saved?.statusCard && <div className="min-w-0 max-xl:-order-1">{saved.statusCard}</div>}
        {saved && order ? <OrderLinkCard state={orderLinkState(order)} link={saved.link} /> : <OrderLinkCard pendingSave state={null} link={{ kind: "unavailable" }} />}
        <div className="min-w-0 max-xl:order-5">
          <OrderDeliveryCard state={state} settings={settings} invalid={deliveryMarks} settingsHref={links.deliverySettings} onChange={setDelivery}
            onDeliverImmediatelyChange={(deliverImmediately) => change({ ...state, draft: { ...draft, deliverImmediately } })} />
        </div>
      </div>
    </div>

    {headerOutOfView && <div className="fixed inset-x-0 bottom-0 z-40 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] xl:hidden">
      <div className="min-w-0"><p className="text-xs text-muted-foreground">{t(stickyLabel)}</p>
        <p className="font-semibold tabular-nums">{total}</p></div>
      <div className="flex min-w-0 basis-full items-center justify-end gap-2 empty:hidden sm:basis-auto">{stickyActions}</div>
    </div>}

    <Dialog open={discarding} onOpenChange={(open) => { if (!open) setDiscarding(false); }}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader><DialogTitle>{t(discardTitle)}</DialogTitle></DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setDiscarding(false)}>{t("orderView.discard.keepEditing")}</Button>
          <Button type="button" onClick={confirmDiscard}>{t(discardConfirm)}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={reloading} onOpenChange={(open) => { if (!open) setReloading(false); }}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader><DialogTitle>{t("orderView.discard.reloadTitle")}</DialogTitle></DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setReloading(false)}>{t("orderView.discard.reloadKeep")}</Button>
          <Button type="button" onClick={() => { setReloading(false); saved?.onReload(); }}>{t("orderView.discard.reloadConfirm")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={guard.blocked} onOpenChange={(open) => { if (!open) guard.stay(); }}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader><DialogTitle>{t(guard.mode === "doubt" ? "orderView.discard.doubtTitle" : "orderView.discard.leaveTitle")}</DialogTitle></DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={guard.stay}>{t(guard.mode === "doubt" ? "orderView.discard.doubtStay" : "orderView.discard.keepEditing")}</Button>
          <Button type="button" onClick={guard.leave}>{t(guard.mode === "doubt" ? "orderView.discard.doubtLeave" : "orderView.discard.leaveConfirm")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
