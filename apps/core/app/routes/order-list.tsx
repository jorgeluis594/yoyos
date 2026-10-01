import { useTranslation } from "react-i18next";
import { companyPath } from "@core/app/locale";
import { formatCurrency } from "@core/app/format-currency";
import { useState } from "react";
import { z } from "zod";
import { Form, isRouteErrorResponse, Link, useLoaderData, useLocation, type LoaderFunctionArgs } from "react-router";
import { SlidersHorizontal } from "lucide-react";
import { listOrderAggregatesSchema, orderListLoaderSchema, orderContactsSchema } from "@shared/contracts/orders";
import { limaMidnightUtc } from "@shared/orders-date";
import { privateUserContext } from "@core/app/private-user-context";
import { orders } from "@core/src/features/orders/composition";
import { toOrderAggregateListJson } from "@core/src/features/orders/presentation/order-json";
import type { ContactId } from "@core/src/features/orders/domain/order";
import { Button } from "@core/app/components/ui/button";
import { Field, FieldLabel } from "@core/app/components/ui/field";
import { Input } from "@core/app/components/ui/input";
import { ErrorState } from "@core/app/components/ui/error-state";
import { DataTable, type TableColumn } from "@core/app/components/ui/data-table";
import { FilterBar } from "@core/app/components/ui/filter-bar";
import { PageHeader } from "@core/app/components/ui/page-header";
import { Sheet, SheetContent, SheetTrigger } from "@core/app/components/ui/sheet";

const salesTimeZone = "America/Lima";
export async function loader({ request, context }: LoaderFunctionArgs) {
  const params = new URL(request.url).searchParams;
  const raw = Object.fromEntries(params);
  const customerSearch = (raw.customerSearch ?? "").trim();
  delete raw.customerSearch;
  if ([raw.createdFrom, raw.createdBefore].some((date) => date && !z.iso.date().safeParse(date).success))
    throw new Response("Filtros no válidos", { status: 400 });
  const parsed = listOrderAggregatesSchema.safeParse({ ...raw,
    ...(raw.contactId ? {} : { contactId: undefined }),
    ...(raw.createdFrom ? { createdFrom: limaMidnightUtc(raw.createdFrom) } : { createdFrom: undefined }),
    ...(raw.createdBefore ? { createdBefore: limaMidnightUtc(raw.createdBefore) } : { createdBefore: undefined }),
  });
  if (!parsed.success) throw new Response("Filtros no válidos", { status: 400 });
  const { page, customer, contactId, createdFrom, createdBefore } = parsed.data;
  const company = context.get(privateUserContext).company;
  const user = context.get(privateUserContext).user;
  const result = await orders.listAggregates({ page, customer: customer === "contact" ? { kind: "contact", contactId: contactId! as ContactId } : { kind: customer },
    ...(createdFrom ? { createdFrom: new Date(createdFrom) } : {}), ...(createdBefore ? { createdBefore: new Date(createdBefore) } : {}) },
  { companyId: company.id, userId: user.id });
  if (!result.success) throw new Response(result.error.message, { status: result.error.code === "INVALID_ORDER" ? 400 : 503 });
  const [searched, selected] = await Promise.all([orders.searchContacts(customerSearch), contactId ? orders.contactById(contactId) : Promise.resolve(null)]);
  if (!searched.success || (selected && !selected.success)) throw new Response("No se pudieron cargar los contactos.", { status: 503 });
  const contacts = orderContactsSchema.parse(searched.data);
  const selectedContact = selected?.success ? selected.data : null;
  if (selectedContact && !contacts.some((contact) => contact.id === selectedContact.id)) contacts.unshift(orderContactsSchema.element.parse(selectedContact));
  return orderListLoaderSchema.parse({ list: toOrderAggregateListJson(result.data), filters: parsed.data, contacts, customerSearch, base: companyPath(new URL(request.url).pathname, company.country, "/orders") });
}

export default function OrderList() {
  const { t, i18n } = useTranslation();
  const { list, filters, contacts, customerSearch, base } = useLoaderData<typeof loader>();
  const { search } = useLocation();
  type Sale = (typeof list.items)[number];
  const columns: TableColumn<Sale>[] = [
    { id: "customer", header: t("orders.customer"), mobile: "title", cell: (item) => <div className="flex flex-col gap-0.5"><Link to={`${base}/${item.id}`} className="font-medium text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring">{item.customer.kind === "contact" ? item.customer.name ?? item.customer.phone : t("orders.generalPublic")}</Link>{item.customer.kind === "contact" && item.customer.name && <span className="text-xs text-muted-foreground">{item.customer.phone}</span>}</div> },
    { id: "createdAt", header: t("orders.dateAndStatus"), mobile: "description", cell: (item) => <>{new Date(item.createdAt).toLocaleString(i18n.language === "pt" ? "pt-BR" : "es-PE", { dateStyle: "medium", timeStyle: "short", timeZone: salesTimeZone })} · {t(`orders.statusShort.${item.status}`)}</> },
    { id: "total", header: t("orders.total"), mobile: "value", align: "right", cell: (item) => <strong className="font-semibold tabular-nums">{formatCurrency(item.total.amount, item.total.currency, i18n.language)}</strong> },
  ];
  const pageUrl = (page: number) => `${base}?${new URLSearchParams({ customer: filters.customer,
    ...(filters.contactId ? { contactId: filters.contactId } : {}),
    ...(customerSearch ? { customerSearch } : {}),
    ...(filters.createdFrom ? { createdFrom: filters.createdFrom.slice(0, 10) } : {}),
    ...(filters.createdBefore ? { createdBefore: filters.createdBefore.slice(0, 10) } : {}), page: String(page) })}`;
  const activeFilterInputs = [
    { name: "customer", value: filters.customer },
    ...(filters.contactId ? [{ name: "contactId", value: filters.contactId }] : []),
    ...(filters.createdFrom ? [{ name: "createdFrom", value: filters.createdFrom.slice(0, 10) }] : []),
    ...(filters.createdBefore ? [{ name: "createdBefore", value: filters.createdBefore.slice(0, 10) }] : []),
  ];
  return <section>
    <PageHeader>
      <PageHeader.Heading>
        <PageHeader.Title>{t("orders.title")}<PageHeader.Count>{list.total}</PageHeader.Count></PageHeader.Title>
      </PageHeader.Heading>
      <PageHeader.Actions><Button asChild><Link to={`${base}/new`}>{t("orders.new")}</Link></Button></PageHeader.Actions>
    </PageHeader>
    <FilterBar searchName="customerSearch" searchValue={customerSearch} searchLabel={t("orders.searchContactFilter")} submitLabel={t("orders.searchContact")} hiddenFields={activeFilterInputs} action={<OrderFilterSheet key={search} filters={filters} contacts={contacts} customerSearch={customerSearch} base={base} />} />
    <DataTable className="mt-6" columns={columns} caption={t("orders.allOrders")} data={list.items} getRowId={(item) => item.id} emptyMessage={t("orders.emptyFiltered")} />
    <nav aria-label={t("orders.pages")} className="mt-6 flex items-center justify-end gap-2"><span className="mr-auto text-sm text-muted-foreground">{t("orders.page", { page: list.page })}</span>{list.page > 1 && <Button asChild variant="outline"><Link to={pageUrl(list.page - 1)}>{t("orders.previous")}</Link></Button>}{list.page * list.pageSize < list.total && <Button asChild variant="outline"><Link to={pageUrl(list.page + 1)}>{t("orders.next")}</Link></Button>}</nav>
  </section>;
}

function OrderFilterSheet({ filters, contacts, customerSearch, base }: Pick<Awaited<ReturnType<typeof loader>>, "filters" | "contacts" | "customerSearch" | "base">) {
  const { t } = useTranslation();
  const [customer, setCustomer] = useState(filters.customer);
  const activeFilters = Number(filters.customer !== "all") + Number(!!filters.createdFrom) + Number(!!filters.createdBefore);
  return <Sheet><SheetTrigger asChild><Button variant="outline" className="min-h-11" aria-label={activeFilters ? t(activeFilters === 1 ? "orders.activeFilter_one" : "orders.activeFilter_other", { count: activeFilters }) : t("orders.filters")}><SlidersHorizontal data-icon="inline-start" aria-hidden="true" />{t("orders.filters")}{activeFilters ? ` (${activeFilters})` : ""}</Button></SheetTrigger>
      <SheetContent title={t("orders.filterTitle")} description={t("orders.filterDescription")}>
        <Form method="get" className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
          <input type="hidden" name="customerSearch" value={customerSearch} />
          <Field><FieldLabel htmlFor="order-customer">{t("orders.customer")}</FieldLabel><select id="order-customer" name="customer" value={customer} onChange={(event) => setCustomer(event.target.value as typeof customer)} className="min-h-10 rounded-[var(--radius-control)] border border-input bg-background px-3 font-normal"><option value="all">{t("orders.allCustomers")}</option><option value="general_public">{t("orders.generalPublic")}</option><option value="contact">{t("orders.contact")}</option></select></Field>
          {customer === "contact" && <div className="flex flex-col gap-2"><Field><FieldLabel htmlFor="order-contact">{t("orders.contact")}</FieldLabel><select id="order-contact" name="contactId" defaultValue={filters.contactId ?? ""} required className="min-h-10 rounded-[var(--radius-control)] border border-input bg-background px-3 font-normal"><option value="">{t("orders.selectContact")}</option>{contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name ? `${contact.name} · ${contact.phone}` : contact.phone}</option>)}</select></Field><p className="text-xs text-muted-foreground">{t("orders.contactHint")}</p></div>}
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
