import { useState } from "react";
import { Form, isRouteErrorResponse, Link, useLoaderData, useLocation, type LoaderFunctionArgs } from "react-router";
import { SlidersHorizontal } from "lucide-react";
import { listOrdersSchema, orderListLoaderSchema, saleContactsSchema } from "@shared/contracts/orders";
import { privateUserContext } from "@core/app/private-user-context";
import { orders } from "@core/src/features/orders/composition";
import { toOrderListJson } from "@core/src/features/orders/presentation/order-json";
import type { ContactId } from "@core/src/features/orders/domain/order";
import { Button } from "@core/app/components/ui/button";
import { Field, FieldLabel } from "@core/app/components/ui/field";
import { Input } from "@core/app/components/ui/input";
import { ErrorState } from "@core/app/components/ui/error-state";
import { DataTable, type TableColumn } from "@core/app/components/ui/data-table";
import { FilterBar } from "@core/app/components/ui/filter-bar";
import { PageHeader } from "@core/app/components/ui/page-header";
import { Sheet, SheetContent, SheetTrigger } from "@core/app/components/ui/sheet";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const params = new URL(request.url).searchParams;
  const raw = Object.fromEntries(params);
  const customerSearch = (raw.customerSearch ?? "").trim();
  delete raw.customerSearch;
  const parsed = listOrdersSchema.safeParse({ ...raw,
    ...(raw.contactId ? {} : { contactId: undefined }),
    ...(raw.completedFrom ? { completedFrom: `${raw.completedFrom}T00:00:00.000Z` } : { completedFrom: undefined }),
    ...(raw.completedBefore ? { completedBefore: `${raw.completedBefore}T00:00:00.000Z` } : { completedBefore: undefined }),
  });
  if (!parsed.success) throw new Response("Filtros no válidos", { status: 400 });
  const { page, customer, contactId, completedFrom, completedBefore } = parsed.data;
  const result = await orders.list({ page, customer: customer === "contact" ? { kind: "contact", contactId: contactId! as ContactId } : { kind: customer },
    ...(completedFrom ? { completedFrom: new Date(completedFrom) } : {}), ...(completedBefore ? { completedBefore: new Date(completedBefore) } : {}) });
  if (!result.success) throw new Response(result.error.message, { status: result.error.code === "INVALID_ORDER" ? 400 : 503 });
  const [searched, selected] = await Promise.all([orders.searchContacts(customerSearch), contactId ? orders.contactById(contactId) : Promise.resolve(null)]);
  if (!searched.success || (selected && !selected.success)) throw new Response("No se pudieron cargar los contactos.", { status: 503 });
  const contacts = saleContactsSchema.parse(searched.data);
  const selectedContact = selected?.success ? selected.data : null;
  if (selectedContact && !contacts.some((contact) => contact.id === selectedContact.id)) contacts.unshift(saleContactsSchema.element.parse(selectedContact));
  const company = context.get(privateUserContext).company;
  return orderListLoaderSchema.parse({ list: toOrderListJson(result.data), filters: parsed.data, contacts, customerSearch, base: `/es-${company.country}/orders` });
}

export default function OrderList() {
  const { list, filters, contacts, customerSearch, base } = useLoaderData<typeof loader>();
  const { search } = useLocation();
  type Sale = (typeof list.items)[number];
  const columns: TableColumn<Sale>[] = [
    { id: "customer", header: "Cliente", mobile: "title", cell: (item) => <div className="flex flex-col gap-0.5"><Link to={`${base}/${item.id}`} className="font-medium text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring">{item.customer.kind === "contact" ? item.customer.name ?? item.customer.phone : "Público general"}</Link>{item.customer.kind === "contact" && item.customer.name && <span className="text-xs text-muted-foreground">{item.customer.phone}</span>}</div> },
    { id: "completedAt", header: "Fecha y hora", mobile: "description", cell: (item) => new Date(item.completedAt).toLocaleString("es-PE", { dateStyle: "medium", timeStyle: "short" }) },
    { id: "total", header: "Total", mobile: "value", align: "right", cell: (item) => <strong className="font-semibold tabular-nums">{item.total.toFixed(2)} {item.currency}</strong> },
  ];
  const pageUrl = (page: number) => `${base}?${new URLSearchParams({ customer: filters.customer,
    ...(filters.contactId ? { contactId: filters.contactId } : {}),
    ...(customerSearch ? { customerSearch } : {}),
    ...(filters.completedFrom ? { completedFrom: filters.completedFrom.slice(0, 10) } : {}),
    ...(filters.completedBefore ? { completedBefore: filters.completedBefore.slice(0, 10) } : {}), page: String(page) })}`;
  const activeFilterInputs = [
    { name: "customer", value: filters.customer },
    ...(filters.contactId ? [{ name: "contactId", value: filters.contactId }] : []),
    ...(filters.completedFrom ? [{ name: "completedFrom", value: filters.completedFrom.slice(0, 10) }] : []),
    ...(filters.completedBefore ? [{ name: "completedBefore", value: filters.completedBefore.slice(0, 10) }] : []),
  ];
  return <section>
    <PageHeader>
      <PageHeader.Heading>
        <PageHeader.Title>Ventas<PageHeader.Count>{list.total} {list.total === 1 ? "venta completada" : "ventas completadas"}</PageHeader.Count></PageHeader.Title>
      </PageHeader.Heading>
      <PageHeader.Actions><Button asChild><Link to={`${base}/new`}>Nueva venta</Link></Button></PageHeader.Actions>
    </PageHeader>
    <FilterBar searchName="customerSearch" searchValue={customerSearch} searchLabel="Buscar contacto para filtrar" submitLabel="Buscar contacto" hiddenFields={activeFilterInputs} action={<OrderFilterSheet key={search} filters={filters} contacts={contacts} customerSearch={customerSearch} base={base} />} />
    <DataTable className="mt-6" columns={columns} caption="Ventas completadas" data={list.items} getRowId={(item) => item.id} emptyMessage="No hay ventas para estos filtros." />
    <nav aria-label="Páginas de ventas" className="mt-6 flex items-center justify-end gap-2"><span className="mr-auto text-sm text-muted-foreground">Página {list.page}</span>{list.page > 1 && <Button asChild variant="outline"><Link to={pageUrl(list.page - 1)}>Anterior</Link></Button>}{list.page * list.pageSize < list.total && <Button asChild variant="outline"><Link to={pageUrl(list.page + 1)}>Siguiente</Link></Button>}</nav>
  </section>;
}

function OrderFilterSheet({ filters, contacts, customerSearch, base }: Pick<Awaited<ReturnType<typeof loader>>, "filters" | "contacts" | "customerSearch" | "base">) {
  const [customer, setCustomer] = useState(filters.customer);
  const activeFilters = Number(filters.customer !== "all") + Number(!!filters.completedFrom) + Number(!!filters.completedBefore);
  return <Sheet><SheetTrigger asChild><Button variant="outline" aria-label={activeFilters ? `${activeFilters} ${activeFilters === 1 ? "filtro activo" : "filtros activos"}` : "Filtros"}><SlidersHorizontal data-icon="inline-start" aria-hidden="true" />Filtros{activeFilters ? ` (${activeFilters})` : ""}</Button></SheetTrigger>
      <SheetContent title="Filtros de ventas" description="Refina las ventas por cliente y fecha.">
        <Form method="get" className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
          <input type="hidden" name="customerSearch" value={customerSearch} />
          <Field><FieldLabel htmlFor="order-customer">Cliente</FieldLabel><select id="order-customer" name="customer" value={customer} onChange={(event) => setCustomer(event.target.value as typeof customer)} className="min-h-10 rounded-[var(--radius-control)] border border-input bg-background px-3 font-normal"><option value="all">Todos los clientes</option><option value="general_public">Público general</option><option value="contact">Contacto</option></select></Field>
          {customer === "contact" && <div className="flex flex-col gap-2"><Field><FieldLabel htmlFor="order-contact">Contacto</FieldLabel><select id="order-contact" name="contactId" defaultValue={filters.contactId ?? ""} required className="min-h-10 rounded-[var(--radius-control)] border border-input bg-background px-3 font-normal"><option value="">Seleccionar contacto</option>{contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name ? `${contact.name} · ${contact.phone}` : contact.phone}</option>)}</select></Field><p className="text-xs text-muted-foreground">Busca un contacto en la barra sobre las ventas para encontrarlo aquí.</p></div>}
          <div className="flex flex-col gap-4 border-t pt-5"><p className="text-sm font-medium">Fecha de venta</p><Field><FieldLabel htmlFor="completed-from">Desde</FieldLabel><Input id="completed-from" name="completedFrom" type="date" defaultValue={filters.completedFrom?.slice(0, 10)} /></Field><Field><FieldLabel htmlFor="completed-before">Antes de</FieldLabel><Input id="completed-before" name="completedBefore" type="date" defaultValue={filters.completedBefore?.slice(0, 10)} /></Field></div>
          <div className="mt-auto flex gap-2 border-t pt-5"><Button asChild variant="outline" className="flex-1"><Link to={base}>Limpiar</Link></Button><Button type="submit" className="flex-1">Aplicar filtros</Button></div>
        </Form>
      </SheetContent>
    </Sheet>;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  const invalid = isRouteErrorResponse(error) && error.status === 400;
  return <ErrorState title={invalid ? "Filtros no válidos" : "No se pudieron cargar las ventas"} description={invalid ? "Revisa los filtros e inténtalo de nuevo." : "Inténtalo de nuevo."} action={<Button asChild variant="outline"><a href="?">Volver a ventas</a></Button>} />;
}
