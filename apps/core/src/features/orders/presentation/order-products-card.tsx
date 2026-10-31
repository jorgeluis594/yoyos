import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Minus, Plus, Search, Trash2 } from "lucide-react";
import { multiply } from "@shared/money";
import { maxOrderLineQuantity } from "@shared/orders-edit";
import { mentionedPriceNote } from "@shared/mentioned-price";
import { Button } from "@core/app/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@core/app/components/ui/card";
import { formatCurrency } from "@core/app/format-currency";
import { cn } from "@core/app/lib/utils";
import { joinNames, shortItemLines } from "@core/src/features/orders/presentation/stock-due";
import { ProductPickerDialog, initialsOf, type PickerChoice } from "@core/src/features/orders/presentation/product-picker-dialog";
import type { CatalogSearch } from "@core/src/features/orders/presentation/use-catalog-search";
import { estimate, invalidFields, lineWarnings, screenLocks, unsavedParts, type DraftLine, type OrderViewState, type ProductsLock } from "@core/src/features/orders/presentation/order-view-state";

const lockNoteKeys = {
  shipped: "orderView.products.lockedShipped", delivered: "orderView.products.lockedDelivered",
} as const satisfies Readonly<Record<Exclude<ProductsLock, "cancelled">, string>>;

function quantityOf(line: DraftLine): number | null {
  const text = line.quantityText.trim();
  if (!/^\d+$/.test(text)) return null;
  const quantity = Number(text);
  return quantity >= 1 && quantity <= maxOrderLineQuantity ? quantity : null;
}

/** Units of each variant in the order, for the picker's «✓ n» and its announcements. */
function quantitiesOf(lines: readonly DraftLine[]): ReadonlyMap<string, number> {
  return new Map(lines.map((line) => [line.variantId, quantityOf(line) ?? 0]));
}

const withItems = (state: OrderViewState, items: readonly DraftLine[]): OrderViewState => ({ ...state, draft: { ...state.draft, items } });
const mapLine = (state: OrderViewState, variantId: string, change: (line: DraftLine) => DraftLine) =>
  withItems(state, state.draft.items.map((line) => line.variantId === variantId ? change(line) : line));

/**
 * Adds a catalog variant. A variant already in the order gets one more unit instead of a second line; one the seller removed
 * from a saved order comes back at its saved price, as the estimate and core price it.
 */
export function addVariant(state: OrderViewState, { product, variant }: PickerChoice): OrderViewState {
  const existing = state.draft.items.find((line) => line.variantId === variant.id);
  if (existing) {
    const next = Math.min((quantityOf(existing) ?? 0) + 1, maxOrderLineQuantity);
    return mapLine(state, variant.id, (line) => ({ ...line, quantityText: String(next), stock: variant.stock, sellable: true }));
  }
  const savedLine = state.base?.items.saved.find((line) => line.variantId === variant.id);
  const line: DraftLine = { variantId: variant.id, productName: product.name, attributes: variant.attributes, sku: variant.sku,
    unitPrice: savedLine?.unitPrice ?? { amount: variant.price, currency: product.currency }, quantityText: "1", stock: variant.stock, sellable: true };
  return withItems(state, [...state.draft.items, line]);
}

type Props = Readonly<{
  state: OrderViewState; onChange: (state: OrderViewState) => void;
  /** The view mounts the catalog search, so its cache outlives the picker. */
  search: CatalogSearch; pickerOpen: boolean; onPickerOpenChange: (open: boolean) => void; createProductHref: string;
  /** The variant that a save answered «ya no está disponible» for: its line carries the message. */
  unavailableVariantId?: string | null;
}>;

export function OrderProductsCard({ state, onChange, search, pickerOpen, onPickerOpenChange, createProductHref, unavailableVariantId = null }: Props) {
  const { t, i18n } = useTranslation();
  const lastValid = useRef(new Map<string, string>());
  const addRef = useRef<HTMLButtonElement>(null);
  const money = (amount: number, currency: string) => formatCurrency(amount, currency, i18n.language);
  const { items } = state.draft;
  const locks = screenLocks(state);
  const locked = locks.products !== null;
  const order = state.loaded?.order;
  const invalid = invalidFields(state).filter((field) => field.section === "items" && field.id !== undefined);
  const totals = estimate(state);
  const units = items.reduce((sum, line) => sum + (quantityOf(line) ?? 0), 0);
  const onlyLine = state.base !== null && items.length === 1;
  const stockState = order && !order.cancelled && order.stockDue === null ? (order.stockDeducted ? "stockDeducted" : "stockPending") : null;
  const isEstimate = state.base === null || unsavedParts(state).length > 0;

  const setQuantity = (variantId: string, quantityText: string) => onChange(mapLine(state, variantId, (line) => ({ ...line, quantityText })));
  const typeQuantity = (line: DraftLine, raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 7);
    if (quantityOf(line) !== null) lastValid.current.set(line.variantId, line.quantityText);
    setQuantity(line.variantId, digits);
  };
  const restoreQuantity = (line: DraftLine) => { if (line.quantityText.trim() === "") setQuantity(line.variantId, lastValid.current.get(line.variantId) ?? "1"); };
  const lastLineNoteId = "order-products-last-line";
  const remove = (variantId: string) => onChange(withItems(state, items.filter((line) => line.variantId !== variantId)));

  const lineView = (line: DraftLine) => {
    const quantity = quantityOf(line);
    const variant = Object.values(line.attributes).join(" · ") || t("orderView.products.uniqueVariant");
    const warnings = lineWarnings(state, line);
    const reason = invalid.find((field) => field.id === line.variantId && field.field === "quantity")?.reason;
    const errorId = `quantity-error-${line.variantId}`;
    const savedItem = order?.items.find((candidate) => candidate.variantId === line.variantId);
    const note = savedItem ? mentionedPriceNote(savedItem) : null;
    const subtotal = quantity === null ? null : multiply(line.unitPrice)(quantity);
    const price = money(line.unitPrice.amount, line.unitPrice.currency);
    return <li key={line.variantId} id={`order-line-${line.variantId}`} tabIndex={-1} className="grid gap-2 py-3 outline-none">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-semibold text-muted-foreground">{initialsOf(line.productName)}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{line.productName}</p>
          <p className="text-sm text-muted-foreground">{t("orderView.products.lineDetail", { variant, price })}</p>
          {note && <p className="text-sm text-muted-foreground">{t("orderDetail.mentionedPrice", { count: note.units, amount: money(note.amount, line.unitPrice.currency) })}</p>}
        </div>
        <Button type="button" variant="ghost" size="icon" className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent" aria-label={t("orderView.products.removeLine", { name: line.productName, variant })}
          disabled={locked} aria-disabled={onlyLine || undefined} aria-describedby={onlyLine && !locked ? lastLineNoteId : undefined}
          onClick={() => { if (!onlyLine) remove(line.variantId); }}><Trash2 aria-hidden="true" /></Button>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button type="button" variant="outline" size="icon" aria-label={t("orderView.products.decrease")} disabled={locked || quantity === null || quantity <= 1}
            onClick={() => setQuantity(line.variantId, String((quantity ?? 1) - 1))}><Minus aria-hidden="true" /></Button>
          <input type="text" inputMode="numeric" autoComplete="off" data-quantity="" aria-label={`${t("orderView.products.quantity")}: ${line.productName}, ${variant}`}
            aria-invalid={reason !== undefined} aria-describedby={reason ? errorId : undefined} disabled={locked} value={line.quantityText}
            onChange={(event) => typeQuantity(line, event.target.value)} onBlur={() => restoreQuantity(line)}
            className="h-control min-h-touch w-16 rounded-[var(--radius-control)] border bg-background px-2 text-center tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive disabled:opacity-50" />
          <Button type="button" variant="outline" size="icon" aria-label={t("orderView.products.increase")} disabled={locked || (quantity !== null && quantity >= maxOrderLineQuantity)}
            onClick={() => setQuantity(line.variantId, String((quantity ?? 0) + 1))}><Plus aria-hidden="true" /></Button>
        </div>
        <span className="font-medium tabular-nums">{subtotal?.success ? money(subtotal.data.amount, subtotal.data.currency) : ""}</span>
      </div>
      {reason && <p id={errorId} role="alert" className="text-sm text-destructive">
        {reason === "quantity_max" ? t("orderView.products.quantityMax", { max: maxOrderLineQuantity }) : t("orderView.products.quantityInvalid")}</p>}
      {line.variantId === unavailableVariantId && <p role="alert" className="text-sm font-medium text-destructive">{t("orderView.products.unavailable", { name: Object.values(line.attributes).join(" / ") || line.productName })}</p>}
      {warnings.availableStock !== null && <p className="text-sm text-muted-foreground">{t("orderView.products.stockWarning", { stock: warnings.availableStock })}</p>}
      {warnings.noLongerSold && <p className="text-sm text-muted-foreground">{t("orderView.products.deactivated")}</p>}
    </li>;
  };

  const totalRow = (label: string, amount: number, currency: string, strong = false) =>
    <div className={cn("flex justify-between gap-3", strong && "font-semibold")}><dt>{label}</dt><dd className="tabular-nums">{money(amount, currency)}</dd></div>;

  return <Card>
    <CardHeader>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <CardTitle>{t("orderView.products.title")}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {t("orderView.products.productCount", { count: items.length })} · {t("orderView.products.unitCount", { count: units })}
            {stockState && <> · {t(`orderView.products.${stockState}`)}</>}
          </p>
        </div>
        <Button ref={addRef} type="button" variant="outline" aria-label={t("orderView.products.add")} disabled={locked} onClick={() => onPickerOpenChange(true)}>
          {t("orderView.products.add")}<kbd aria-hidden="true" className="ml-2 hidden rounded border px-1.5 text-xs text-muted-foreground [@media(any-pointer:fine)]:inline">/</kbd>
        </Button>
      </div>
    </CardHeader>
    <CardContent className="grid gap-4">
      {order && order.stockDue?.kind === "partial_waiting" && !order.cancelled && <p role="note" className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning-foreground">
        {t("orderView.products.partialStock", { items: joinNames(shortItemLines(order).map((line) => line.name), i18n.language) })}</p>}
      {locks.products !== null && locks.products !== "cancelled" && <p role="note" className="text-sm text-muted-foreground">{t(lockNoteKeys[locks.products])}</p>}
      {items.length === 0
        ? <div className="grid justify-items-center gap-1 py-6 text-center"><p className="font-medium">{t("orderView.products.empty")}</p>
          <p className="text-sm text-muted-foreground">{t("orderView.products.emptyHint")}</p></div>
        : <ul className="divide-y">{items.map(lineView)}</ul>}
      {onlyLine && !locked && <p id={lastLineNoteId} className="text-sm text-muted-foreground">{t("orderView.products.lastLine")}</p>}
      <button type="button" disabled={locked} onClick={() => onPickerOpenChange(true)}
        className="flex min-h-touch items-center gap-2 rounded-[var(--radius-control)] border border-dashed px-3 text-left text-sm text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
        <Search aria-hidden="true" className="size-icon-inline" />{t("orderView.products.searchRow")}
      </button>
      {totals.success && <dl className="grid gap-1 border-t pt-3 text-sm">
        {totalRow(t("orderView.products.subtotal"), totals.data.subtotal.amount, totals.data.subtotal.currency)}
        {totals.data.delivery.amount > 0 && totalRow(t("orderView.products.delivery"), totals.data.delivery.amount, totals.data.delivery.currency)}
        {totalRow(t("orderView.products.paid"), totals.data.paid.amount, totals.data.paid.currency)}
        {totalRow(t("orderView.products.total"), totals.data.total.amount, totals.data.total.currency, true)}
        {totals.data.excess.amount > 0
          ? <p className="pt-1">{t("orderView.products.excess", { amount: money(totals.data.excess.amount, totals.data.excess.currency) })}</p>
          : totals.data.balance.amount > 0 && !order?.cancelled && totalRow(t("orderView.products.balance"), totals.data.balance.amount, totals.data.balance.currency)}
        {isEstimate && <p className="pt-1 text-muted-foreground">{t("orderView.products.estimate")}</p>}
      </dl>}
    </CardContent>
    {pickerOpen && !locked && <ProductPickerDialog search={search} quantities={quantitiesOf(items)} createProductHref={createProductHref}
      onAdd={(choice) => onChange(addVariant(state, choice))} onClose={() => onPickerOpenChange(false)}
      onCloseAutoFocus={(event) => { event.preventDefault(); addRef.current?.focus(); }} />}
  </Card>;
}
