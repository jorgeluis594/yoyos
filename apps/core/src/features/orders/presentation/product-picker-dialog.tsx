import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@core/app/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@core/app/components/ui/dialog";
import { Input } from "@core/app/components/ui/input";
import { TextLink } from "@core/app/components/ui/text-link";
import { formatCurrency } from "@core/app/format-currency";
import { attributesLabel } from "@core/app/lib/variant-attributes-label";
import { cn } from "@core/app/lib/utils";
import { catalogResultLimit, type CatalogProduct, type CatalogSearch, type CatalogVariant } from "@core/src/features/orders/presentation/use-catalog-search";
import { touchTargets } from "@core/src/features/orders/presentation/touch-targets";
import { isPickerKey, pickerKey, type PickerHighlight } from "@core/src/features/orders/presentation/product-picker-keyboard";

export type PickerChoice = Readonly<{ product: CatalogProduct; variant: CatalogVariant }>;

/** The search state comes from the view's `useCatalogSearch`; `quantities` is the units of each variant already in the order. */
type Props = Readonly<{
  search: CatalogSearch; quantities: ReadonlyMap<string, number>; createProductHref: string;
  onAdd: (choice: PickerChoice) => void; onClose: () => void; onCloseAutoFocus?: (event: Event) => void;
}>;

const hasOptions = (product: CatalogProduct) => product.variants.some((variant) => Object.keys(variant.attributes).length > 0);
const isDifferentPrice = (product: CatalogProduct) => new Set(product.variants.map((variant) => variant.price)).size > 1;

/** «TP» for «Traje de Príncipe Azul»: the first letters of its first two significant words. */
export function initialsOf(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  const significant = words.filter((word) => word.length > 2);
  return (significant.length > 0 ? significant : words).slice(0, 2).map((word) => word[0]!.toUpperCase()).join("");
}

export function ProductPickerDialog({ search, quantities, createProductHref, onAdd, onClose, onCloseAutoFocus }: Props) {
  const { t, i18n } = useTranslation();
  const baseId = useId();
  const listId = `${baseId}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [highlight, setHighlight] = useState<PickerHighlight>(null);
  // The distinct variants added during this opening: «Listo · n agregados» counts them, not the clicks.
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());
  const [announcement, setAnnouncement] = useState("");
  const { products, text, inStock, status } = search;
  const { open, close } = search;
  useEffect(() => { open(); return close; }, [open, close]);
  // Typing, changing the filter or receiving a new result set clears the highlight, so the arrows go back to the text.
  const [shown, setShown] = useState({ products, text, inStock });
  if (shown.products !== products || shown.text !== text || shown.inStock !== inStock) { setShown({ products, text, inStock }); setHighlight(null); }

  const failed = status === "error";
  // The previous results stay in memory while a search fails but are not shown, so the keyboard must not reach them.
  const listShown = !failed && products.length > 0;
  const rows = useMemo(() => (listShown ? products : []).map((product) => ({ variantCount: product.variants.length, hasOptions: hasOptions(product) })), [products, listShown]);
  const money = (amount: number, currency: string) => formatCurrency(amount, currency, i18n.language);
  const stockText = (stock: number) => stock > 0 ? t("orderView.picker.inStock", { stock }) : t("orderView.picker.noStock");
  const productId = (index: number) => `${baseId}-p${index}`;
  const chipId = (index: number, chip: number) => `${baseId}-p${index}-c${chip}`;
  const activeId = listShown && highlight ? highlight.chip === null ? productId(highlight.product) : chipId(highlight.product, highlight.chip) : undefined;
  useEffect(() => { if (activeId) document.getElementById(activeId)?.scrollIntoView?.({ block: "nearest" }); }, [activeId]);

  const add = (product: CatalogProduct, variant: CatalogVariant) => {
    const count = (quantities.get(variant.id) ?? 0) + 1;
    const label = attributesLabel(variant.attributes);
    onAdd({ product, variant });
    setAdded((previous) => new Set(previous).add(variant.id));
    setAnnouncement(t("orderView.picker.added", { name: label ? `${product.name}, ${label}` : product.name, count }));
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (!isPickerKey(event.key) || event.nativeEvent.isComposing) return;
    const outcome = pickerKey(event.key, listShown ? highlight : null, rows);
    if (outcome.preventDefault) event.preventDefault();
    setHighlight(outcome.highlight);
    if (outcome.add) add(products[outcome.add.product]!, products[outcome.add.product]!.variants[outcome.add.variant]!);
  };
  const changeText = (next: string) => { setHighlight(null); search.setText(next); };
  const changeFilter = (next: boolean) => { setHighlight(null); search.setInStock(next); };

  const loadingFirst = (status === "loading" || status === "idle") && products.length === 0;
  const empty = !failed && !loadingFirst && products.length === 0;
  const filterButton = (value: boolean, label: string) =>
    <Button type="button" size="sm" variant={inStock === value ? "default" : "outline"} aria-pressed={inStock === value} onClick={() => changeFilter(value)}>{label}</Button>;

  return <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
    <DialogContent aria-describedby={undefined} closeLabel={t("common.close")} onCloseAutoFocus={onCloseAutoFocus}
      onOpenAutoFocus={(event) => { event.preventDefault(); inputRef.current?.focus(); }}
      className={cn(touchTargets, "top-0 left-0 grid h-dvh max-w-none translate-x-0 translate-y-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-3 overflow-hidden rounded-none sm:top-1/2 sm:left-1/2 sm:h-[min(40rem,calc(100dvh-4rem))] sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[var(--radius-overlay)]")}>
      <DialogHeader><DialogTitle>{t("orderView.products.add")}</DialogTitle></DialogHeader>
      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <label htmlFor={`${baseId}-search`} className="sr-only">{t("orderView.picker.searchLabel")}</label>
          <Input id={`${baseId}-search`} ref={inputRef} type="text" role="combobox" autoComplete="off" aria-autocomplete="list" aria-expanded={listShown}
            aria-controls={listShown ? listId : undefined} aria-activedescendant={activeId} placeholder={t("orderView.picker.searchLabel")}
            value={text} onChange={(event) => changeText(event.target.value)} onKeyDown={onKeyDown} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {filterButton(false, t("orderView.picker.filterAll"))}{filterButton(true, t("orderView.picker.filterInStock"))}
          {!loadingFirst && <span className="ml-auto text-sm text-muted-foreground">{t("orderView.picker.results", { count: products.length })}</span>}
        </div>
      </div>
      <div className="min-h-0 overflow-x-hidden overflow-y-auto">
        {loadingFirst && <p className="py-6 text-center text-sm text-muted-foreground">{t("orderView.picker.loading")}</p>}
        {failed && <div className="grid justify-items-center gap-3 py-6 text-center"><p role="alert">{t("orderView.picker.loadError")}</p>
          <Button type="button" variant="outline" onClick={search.retry}>{t("orderView.picker.retry")}</Button></div>}
        {empty && <div className="grid justify-items-center gap-1 py-6 text-center">
          <p className="font-medium">{text.trim() ? t("orderView.picker.noResults", { query: text.trim() }) : t("orderView.picker.emptyCatalog")}</p>
          {text.trim() && <p className="text-muted-foreground">{t("orderView.picker.noResultsHint")}</p>}
          <TextLink href={createProductHref} target="_blank" rel="noopener noreferrer">{t("orderView.picker.createTab")}</TextLink></div>}
        {listShown && <ul id={listId} role="listbox" aria-label={t("orderView.picker.searchLabel")} aria-busy={status === "loading"} className="grid gap-2">
          {products.map((product, index) => {
            const options = hasOptions(product);
            const differs = isDifferentPrice(product);
            const first = product.variants[0]!;
            const selected = highlight?.product === index && highlight.chip === null;
            const nameId = `${productId(index)}-name`;
            const ring = "ring-2 ring-ring";
            // Each product is a group named by its name. Its highlightable parts are options: the summary row, or «Agregar» when there are no variants to choose.
            return <li key={product.id} role="group" aria-labelledby={nameId} className="grid gap-2 rounded-[var(--radius-control)] border p-3">
              <div id={options ? productId(index) : undefined} role={options ? "option" : undefined} aria-selected={options ? selected : undefined}
                className={cn("flex items-center gap-3 rounded-[var(--radius-control)]", options && selected && ring)}>
                <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-semibold text-muted-foreground">{initialsOf(product.name)}</span>
                <div className="min-w-0 flex-1">
                  <p id={nameId} className="truncate font-medium">{product.name}</p>
                  <p className="text-sm text-muted-foreground">{options
                    ? t("orderView.picker.variantCount", { count: product.variants.length })
                    : t("orderView.picker.singleVariant", { stock: first.stock })}</p>
                </div>
                <span className="shrink-0 text-sm font-semibold tabular-nums">{differs
                  ? t("orderView.picker.priceFrom", { price: money(Math.min(...product.variants.map((variant) => variant.price)), product.currency) })
                  : money(first.price, product.currency)}</span>
                {!options && <Button id={productId(index)} role="option" aria-selected={selected} type="button" size="sm" variant="outline" aria-describedby={nameId}
                  className={cn(selected && ring)} onClick={() => add(product, first)}>{t("orderView.picker.add")}</Button>}
              </div>
              {options && <div className="flex flex-wrap gap-2">
                {product.variants.map((variant, chip) => {
                  const inOrder = quantities.get(variant.id) ?? 0;
                  const stock = stockText(variant.stock);
                  const label = attributesLabel(variant.attributes) || variant.sku || t("orderView.products.uniqueVariant");
                  const base = inOrder > 0 ? t("orderView.picker.chipNameInOrder", { variant: label, stock, count: inOrder }) : t("orderView.picker.chipName", { variant: label, stock });
                  const name = differs ? t("orderView.picker.chipNameWithPrice", { name: base, price: money(variant.price, product.currency) }) : base;
                  const chipHighlighted = highlight?.product === index && highlight.chip === chip;
                  return <button key={variant.id} id={chipId(index, chip)} type="button" role="option" aria-selected={chipHighlighted} aria-label={name} onClick={() => add(product, variant)}
                    className={cn("min-h-touch rounded-[var(--radius-control)] border bg-background px-3 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring", chipHighlighted && "ring-2 ring-ring")}>
                    <span className="font-medium">{label}</span>{" "}
                    <span className={variant.stock > 0 ? "text-muted-foreground" : "text-destructive"}>{stock}</span>
                    {differs && <span className="block tabular-nums text-muted-foreground">{money(variant.price, product.currency)}</span>}
                    {inOrder > 0 && <span className="ml-1 font-semibold text-primary">{t("orderView.picker.inOrder", { count: inOrder })}</span>}
                  </button>;
                })}
              </div>}
            </li>;
          })}
        </ul>}
        {listShown && products.length >= catalogResultLimit && <p className="pt-3 text-sm text-muted-foreground">{t("orderView.picker.tooMany", { count: catalogResultLimit })}</p>}
      </div>
      <div className="flex items-center justify-between gap-3 border-t pt-3">
        <p className="hidden text-xs text-muted-foreground [@media(any-pointer:fine)]:block">{t("orderView.picker.keyHints")}</p>
        <Button type="button" className="ml-auto" onClick={onClose}>{added.size > 0 ? t("orderView.picker.done", { count: added.size }) : t("orderView.picker.done")}</Button>
      </div>
      <div role="status" aria-live="polite" className="sr-only">{announcement}</div>
    </DialogContent>
  </Dialog>;
}
