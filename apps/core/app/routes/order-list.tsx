import { useTranslation } from "react-i18next";
import { companyPath } from "@core/app/locale";
import { formatCurrency } from "@core/app/format-currency";
import { useState } from "react";
import { cn } from "cn";
import { z } from "zod";
import { Form, isRouteErrorResponse, Link, useLoaderData, useLocation, type LoaderFunctionArgs } from "react-router";
import { orderBuyerText, WhatsAppMark } from "@core/app/components/order-buyer-label";
import { BadgeDollarSign, Check, CircleCheck, CircleX, Coins, PackageCheck, Send, SlidersHorizontal, TriangleAlert, Truck } from "lucide-react";
import { Badge } from "@core/app/components/ui/badge";
import { listOrderAggregatesSchema, orderListLoaderSchema } from "@shared/contracts/orders";
import { limaMidnightUtc } from "@shared/orders-date";
import { privateUserContext } from "@core/app/private-user-context";
import { orders } from "@core/src/features/orders/composition";
import { toOrderAggregateJson, toOrderAggregateListJson, toOrderListDispatchFields } from "@core/src/features/orders/presentation/order-json";
import { Button } from "@core/app/components/ui/button";
import { Field, FieldLabel } from "@core/app/components/ui/field";
import { Input } from "@core/app/components/ui/input";
import { ErrorState } from "@core/app/components/ui/error-state";
import { DataTable, type TableColumn } from "@core/app/components/ui/data-table";
import { FilterBar } from "@core/app/components/ui/filter-bar";
import { PageHeader } from "@core/app/components/ui/page-header";
import { TextLink } from "@core/app/components/ui/text-link";
import { Pagination, PaginationContent, PaginationItem, PaginationNext, PaginationPrevious } from "@core/app/components/ui/pagination";
import { Empty, EmptyDescription, EmptyContent } from "@core/app/components/ui/empty";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@core/app/components/ui/select";
import { Sheet, SheetContent, SheetTrigger } from "@core/app/components/ui/sheet";
import { Checkbox } from "@core/app/components/ui/checkbox";
import { titleCase } from "@core/app/components/zone-entries";
import { DispatchLabelPrintDialog } from "@core/src/features/dispatch-labels/presentation/dispatch-label-print-dialog";
import { OrderLabelSelectionBar } from "@core/src/features/orders/presentation/order-label-selection-bar";
import { pageSelectionState, selectionScope, skipReason, summarizeSelection, type SelectedOrder } from "@core/src/features/orders/presentation/order-label-selection";
import { useOrderLabelSelection } from "@core/src/features/orders/presentation/use-order-label-selection";

const salesTimeZone = "America/Lima";
type CheckoutLabelled = Readonly<{ status: string; checkoutEnabledAt: string | null; checkoutConfirmedAt: string | null }>;
/** Every order is enabled now, so «pending» only describes one still open: a completed order is never waiting for its buyer. */
function checkoutLabel(item: CheckoutLabelled) {
  if (!item.checkoutEnabledAt) return null;
  if (item.status === "cancelled") return "orders.checkoutCancelled";
  if (item.checkoutConfirmedAt) return "orders.checkoutConfirmed";
  return item.status === "active" ? "orders.checkoutPending" : null;
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const params = new URL(request.url).searchParams;
  const raw = Object.fromEntries(params);
  if ([raw.createdFrom, raw.createdBefore].some((date) => date && !z.iso.date().safeParse(date).success))
    throw new Response("Filtros no válidos", { status: 400 });
  const parsed = listOrderAggregatesSchema.safeParse({ ...raw,
    ...(raw.createdFrom ? { createdFrom: limaMidnightUtc(raw.createdFrom) } : { createdFrom: undefined }),
    ...(raw.createdBefore ? { createdBefore: limaMidnightUtc(raw.createdBefore) } : { createdBefore: undefined }),
  });
  if (!parsed.success) throw new Response("Filtros no válidos", { status: 400 });
  const { page, customer, createdFrom, createdBefore, search, view } = parsed.data;
  const company = context.get(privateUserContext).company;
  const user = context.get(privateUserContext).user;
  const result = await orders.listAggregates({ page, customer: { kind: customer },
    ...(search !== undefined ? { search } : {}), ...(view ? { view } : {}),
    ...(createdFrom ? { createdFrom: new Date(createdFrom) } : {}), ...(createdBefore ? { createdBefore: new Date(createdBefore) } : {}) },
  { companyId: company.id, userId: user.id });
  if (!result.success) throw new Response(result.error.message, { status: result.error.code === "INVALID_ORDER" ? 400 : 503 });
  const list = toOrderAggregateListJson(result.data);
  const items = list.items.map((item, index) => ({ ...item,
    itemCount: result.data.items[index].items.reduce((sum, product) => sum + product.quantity, 0),
    balanceDue: toOrderAggregateJson(result.data.items[index]).balanceDue,
    ...toOrderListDispatchFields(result.data.items[index]),
  }));
  return orderListLoaderSchema.parse({ list: { ...list, items }, filters: parsed.data, base: companyPath(new URL(request.url).pathname, company.country, "/orders") });
}

export default function OrderList() {
  const { t, i18n } = useTranslation();
  const { list, filters, base } = useLoaderData<typeof loader>();
  const { search } = useLocation();
  type Sale = (typeof list.items)[number];
  const labels = useOrderLabelSelection(selectionScope(base, filters));
  const [printIds, setPrintIds] = useState<readonly string[]>([]);
  const [printOpen, setPrintOpen] = useState(false);
  const pageOrders: SelectedOrder[] = list.items;
  const summary = summarizeSelection(labels.selection);
  const pageState = pageSelectionState(labels.selection, pageOrders);
  const columns: TableColumn<Sale>[] = [
    { id: "select", mobile: "actions", className: "w-10",
      header: <Checkbox aria-label={t("dispatchLabels.selectPage")} disabled={pageOrders.length === 0} checked={pageState === "all" ? true : pageState === "some" ? "indeterminate" : false} onCheckedChange={() => labels.togglePage(pageOrders)} />,
      cell: (item) => <Checkbox aria-label={t("dispatchLabels.selectOrder", { number: item.number })} checked={!!labels.selection[item.id]} onCheckedChange={() => labels.toggle(item)} /> },
    { id: "number", header: t("orders.listOrder"), mobile: "title", cell: (item) => <div className="flex flex-col items-start">
      <TextLink asChild><Link to={`${base}/${item.id}`} aria-label={t("orders.orderNumber", { number: item.number })}>#{item.number}</Link></TextLink>
      {item.source === "catalog" && <Badge variant="secondary">{t("orders.fromCatalog")}</Badge>}
      <OrderStateIndicators states={item.status === "active" ? [
        { kind: "payment", state: item.paymentStatus, label: item.paymentStatus === "paid" ? t("orders.listStatus.paid") : t("orders.listBalance", { amount: formatCurrency(item.balanceDue.amount, item.balanceDue.currency, i18n.language) }) },
        { kind: "delivery", state: item.deliveryStatus, label: `${t("orders.delivery")}: ${t(`orders.deliveryStatus.${item.deliveryStatus}`)}` },
      ] : [{ kind: "order", state: item.status, label: t(`orders.listStatus.${item.status}`) }]} />
      {checkoutLabel(item) && <span className="text-xs font-normal text-muted-foreground">{t(checkoutLabel(item)!)}</span>}
      <SkipWarning item={item} selected={!!labels.selection[item.id]} />
    </div> },
    { id: "customer", header: t("orders.customer"), mobile: "description", cell: (item) => <div className="flex flex-col gap-1">
      <TextLink asChild><Link to={`${base}/${item.id}`} className="inline-flex items-center gap-1.5">{item.source === "whatsapp" && <WhatsAppMark />}{orderBuyerText(item.buyer, t("orders.generalPublic"))}</Link></TextLink>
      {item.buyer?.name && item.buyer.phone && <span className="text-xs font-normal text-muted-foreground">{item.buyer.phone}</span>}
    </div> },
    { id: "district", header: t("dispatchLabels.district"), mobile: "description", cell: (item) => item.district ? titleCase(item.district) : "—" },
    { id: "createdAt", header: t("orders.listDate"), mobile: "description", cell: (item) => <time dateTime={item.createdAt} className="flex flex-col gap-1">
      <span>{new Date(item.createdAt).toLocaleDateString(i18n.language === "pt" ? "pt-BR" : "es-PE", { dateStyle: "medium", timeZone: salesTimeZone })}</span>
      <span className="text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleTimeString(i18n.language === "pt" ? "pt-BR" : "es-PE", { timeStyle: "short", timeZone: salesTimeZone })}</span>
    </time> },
    { id: "itemCount", header: t("orders.listUnits"), mobile: "description", align: "right", cell: (item) => <span className="tabular-nums">{item.itemCount}</span> },
    { id: "total", header: t("orders.total"), mobile: "value", align: "right", cell: (item) => <strong className="font-semibold tabular-nums">{formatCurrency(item.total.amount, item.total.currency, i18n.language)}</strong> },
  ];
  const activeFilterInputs = [
    { name: "customer", value: filters.customer },
    ...(filters.view ? [{ name: "view", value: filters.view }] : []),
    ...(filters.createdFrom ? [{ name: "createdFrom", value: filters.createdFrom.slice(0, 10) }] : []),
    ...(filters.createdBefore ? [{ name: "createdBefore", value: filters.createdBefore.slice(0, 10) }] : []),
  ];
  const listUrl = (page: number, view = filters.view ?? "all") => `${base}?${new URLSearchParams({
    ...Object.fromEntries(activeFilterInputs.map(({ name, value }) => [name, value])),
    ...(filters.search ? { search: filters.search } : {}), view, page: String(page),
  })}`;
  const filtered = filters.customer !== "all" || !!filters.search || !!filters.createdFrom || !!filters.createdBefore || (filters.view ?? "all") !== "all";
  return <section className={summary.total > 0 ? "pb-20" : undefined}>
    <PageHeader>
      <PageHeader.Heading>
        <PageHeader.Title>{t("orders.title")}<PageHeader.Count>{list.total}</PageHeader.Count></PageHeader.Title>
      </PageHeader.Heading>
      <PageHeader.Actions><Button asChild><Link to={`${base}/new`}>{t("orders.new")}</Link></Button></PageHeader.Actions>
    </PageHeader>
    <nav aria-label={t("orders.listViews")} className="mt-6 flex flex-wrap gap-2">
      {(["all", "unpaid", "undelivered"] as const).map((view) => <Button key={view} asChild variant={(filters.view ?? "all") === view ? "secondary" : "ghost"}>
        <Link to={listUrl(1, view)} aria-current={(filters.view ?? "all") === view ? "page" : undefined}>{(filters.view ?? "all") === view && <Check data-icon="inline-start" aria-hidden="true" />}{t(`orders.listViewsLabels.${view}`)}</Link>
      </Button>)}
    </nav>
    <FilterBar key={search} searchName="search" searchValue={filters.search ?? ""} searchLabel={t("orders.listSearch")} submitLabel={t("orders.listSearchSubmit")} hiddenFields={activeFilterInputs} action={<OrderFilterSheet key={search} filters={filters} base={base} />} />
    <div className="order-list-section mt-6">
      <label className="order-list-select-page flex min-h-touch items-center gap-3 px-1 text-sm font-medium">
        <Checkbox aria-label={t("dispatchLabels.selectPageShort")} disabled={pageOrders.length === 0} checked={pageState === "all" ? true : pageState === "some" ? "indeterminate" : false} onCheckedChange={() => labels.togglePage(pageOrders)} />
        <span aria-hidden="true">{t("dispatchLabels.selectPageShort")}</span>
      </label>
      <DataTable className="order-list-table" columns={columns} caption={t("orders.allOrders")} data={list.items} getRowId={(item) => item.id} getRowClassName={(item) => labels.selection[item.id] ? "bg-muted/40" : ""} emptyMessage={<Empty><EmptyDescription>{t(filtered ? "orders.emptyFiltered" : "orders.listEmpty")}</EmptyDescription>{filtered && <EmptyContent><Button asChild variant="link"><Link to={base}>{t("orders.clear")}</Link></Button></EmptyContent>}</Empty>} />
    </div>
    <Pagination aria-label={t("orders.pages")} className="mt-6 items-center justify-end gap-2"><span className="mr-auto text-sm text-muted-foreground">{t("orders.page", { page: list.page })}</span>
      <PaginationContent>
        {list.page > 1 && <PaginationItem><PaginationPrevious asChild><Link to={listUrl(list.page - 1)}>{t("orders.previous")}</Link></PaginationPrevious></PaginationItem>}
        {list.page * list.pageSize < list.total && <PaginationItem><PaginationNext asChild><Link to={listUrl(list.page + 1)}>{t("orders.next")}</Link></PaginationNext></PaginationItem>}
      </PaginationContent>
    </Pagination>
    {summary.total > 0 && <OrderLabelSelectionBar summary={summary} onClear={labels.clear} onPrint={() => { setPrintIds(summary.printableIds); setPrintOpen(true); }} />}
    <DispatchLabelPrintDialog open={printOpen} onOpenChange={setPrintOpen} orderIds={printIds} />
  </section>;
}

function SkipWarning({ item, selected }: { item: SelectedOrder; selected: boolean }) {
  const { t } = useTranslation();
  const reason = selected ? skipReason(item) : null;
  return reason && <span className="flex items-center gap-1 text-xs font-normal text-[var(--warning)]"><TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />{t(`dispatchLabels.rowSkip.${reason}`)}</span>;
}

function OrderStateIndicators({ states }: { states: { kind: "payment" | "delivery" | "order"; state: "pending" | "paid" | "shipped" | "delivered" | "completed" | "cancelled"; label: string }[] }) {
  const label = states.map((item) => item.label).join(" · ");
  return <details className="order-state-indicator max-w-32">
    <summary aria-label={label} title={label} className="flex cursor-pointer list-none items-center justify-center gap-1 rounded-[var(--radius-control)] transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
      {states.map(({ kind, state }) => {
        const Icon = state === "completed" ? CircleCheck : state === "cancelled" ? CircleX
          : kind === "payment" ? (state === "paid" ? BadgeDollarSign : Coins)
          : state === "delivered" ? PackageCheck : state === "shipped" ? Send : Truck;
        return <Icon key={kind} className={cn("size-4", state === "pending" ? "text-[var(--warning)]" : state === "shipped" ? "text-[var(--info)]" : state === "cancelled" ? "text-muted-foreground" : "text-[var(--success)]")} aria-hidden="true" />;
      })}
    </summary>
    <span className="block pt-1 text-xs font-normal text-muted-foreground">{label}</span>
  </details>;
}

function OrderFilterSheet({ filters, base }: Pick<Awaited<ReturnType<typeof loader>>, "filters" | "base">) {
  const { t } = useTranslation();
  const [customer, setCustomer] = useState(filters.customer);
  const customerItems = [{ value: "all", label: t("orders.allCustomers") }, { value: "general_public", label: t("orders.generalPublic") }];
  const activeFilters = Number(filters.customer !== "all") + Number(!!filters.createdFrom) + Number(!!filters.createdBefore);
  return <Sheet><SheetTrigger asChild><Button variant="outline" className="min-h-control max-md:min-h-touch" aria-label={activeFilters ? t(activeFilters === 1 ? "orders.activeFilter_one" : "orders.activeFilter_other", { count: activeFilters }) : t("orders.filters")}><SlidersHorizontal data-icon="inline-start" aria-hidden="true" />{t("orders.filters")}{activeFilters ? ` (${activeFilters})` : ""}</Button></SheetTrigger>
      <SheetContent title={t("orders.filterTitle")} description={t("orders.filterDescription")}>
        <Form method="get" className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
          <input type="hidden" name="search" value={filters.search ?? ""} />
          {filters.view && <input type="hidden" name="view" value={filters.view} />}
          <Field><FieldLabel htmlFor="order-customer">{t("orders.customer")}</FieldLabel>
            <Select name="customer" items={customerItems} value={customer} onValueChange={value => setCustomer(value as typeof customer)}>
              <SelectTrigger id="order-customer"><SelectValue /></SelectTrigger>
              <SelectContent>{customerItems.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
            </Select></Field>
          <div className="flex flex-col gap-4 border-t pt-5"><p className="text-sm font-medium">{t("orders.creationDate")}</p><Field><FieldLabel htmlFor="created-from">{t("orders.from")}</FieldLabel><Input id="created-from" name="createdFrom" type="date" defaultValue={filters.createdFrom?.slice(0, 10)} /></Field><Field><FieldLabel htmlFor="created-before">{t("orders.before")}</FieldLabel><Input id="created-before" name="createdBefore" type="date" defaultValue={filters.createdBefore?.slice(0, 10)} /></Field></div>
          <div className="mt-auto flex gap-2 border-t pt-5"><Button asChild variant="outline" className="flex-1"><Link to={base}>{t("orders.clear")}</Link></Button><Button type="submit" className="flex-1">{t("orders.apply")}</Button></div>
        </Form>
      </SheetContent>
    </Sheet>;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const invalid = isRouteErrorResponse(error) && error.status === 400;
  return <ErrorState title={invalid ? t("orders.invalidFilters") : t("orders.listError")} description={invalid ? t("orders.invalidFiltersHint") : t("common.retry")} action={<Button asChild variant="outline"><a href="?">{t("orders.backSales")}</a></Button>} />;
}
