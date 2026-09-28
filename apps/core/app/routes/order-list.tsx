import { Form, isRouteErrorResponse, Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { listOrdersSchema, orderListLoaderSchema, saleContactsSchema } from "@shared/contracts/orders";
import { privateUserContext } from "@core/app/private-user-context";
import { orders } from "@core/src/features/orders/composition";
import { toOrderListJson } from "@core/src/features/orders/presentation/order-json";
import type { ContactId } from "@core/src/features/orders/domain/order";
import { Button } from "@core/app/components/ui/button";
import { Input } from "@core/app/components/ui/input";
import { ErrorState } from "@core/app/components/ui/error-state";

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
  const pageUrl = (page: number) => `${base}?${new URLSearchParams({ customer: filters.customer,
    ...(filters.contactId ? { contactId: filters.contactId } : {}),
    ...(customerSearch ? { customerSearch } : {}),
    ...(filters.completedFrom ? { completedFrom: filters.completedFrom.slice(0, 10) } : {}),
    ...(filters.completedBefore ? { completedBefore: filters.completedBefore.slice(0, 10) } : {}), page: String(page) })}`;
  return <section className="space-y-6"><header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">Ventas</h1><p className="text-muted-foreground">{list.total} {list.total === 1 ? "venta completada" : "ventas completadas"}</p></div><Button asChild><Link to={`${base}/new`}>Nueva venta</Link></Button></header>
    <Form method="get" className="flex flex-wrap items-end gap-3"><label>Buscar contacto<Input name="customerSearch" type="search" defaultValue={customerSearch} className="mt-1" /></label><Button type="submit" variant="outline">Buscar contacto</Button></Form>
    <Form method="get" className="flex flex-wrap items-end gap-3"><input type="hidden" name="customerSearch" value={customerSearch} /><label>Cliente<select aria-label="Cliente" name="customer" defaultValue={filters.customer} className="mt-1 block min-h-10 rounded-md border bg-background px-3"><option value="all">Todos</option><option value="general_public">Público general</option><option value="contact">Contacto</option></select></label><label>Contacto<select aria-label="Contacto" name="contactId" defaultValue={filters.contactId ?? ""} className="mt-1 block min-h-10 rounded-md border bg-background px-3"><option value="">Seleccionar contacto</option>{contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name ? `${contact.name} · ${contact.phone}` : contact.phone}</option>)}</select></label><label>Desde<Input name="completedFrom" type="date" defaultValue={filters.completedFrom?.slice(0, 10)} className="mt-1" /></label><label>Antes de<Input name="completedBefore" type="date" defaultValue={filters.completedBefore?.slice(0, 10)} className="mt-1" /></label><Button type="submit">Filtrar</Button></Form>
    {list.items.length === 0 ? <p>No hay ventas para estos filtros.</p> : <ul aria-label="Ventas completadas" className="divide-y rounded-md border">{list.items.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><Link to={`${base}/${item.id}`} className="font-medium text-primary underline-offset-4 hover:underline">{item.customer.kind === "contact" ? item.customer.name ?? item.customer.phone : "Público general"}</Link><p className="text-sm text-muted-foreground">{new Date(item.completedAt).toLocaleString("es-PE")} · Vendedor: {item.sellerId}</p></div><strong>{item.total.toFixed(2)} {item.currency}</strong></li>)}</ul>}
    <nav aria-label="Páginas de ventas" className="flex gap-2">{list.page > 1 && <Button asChild variant="outline"><Link to={pageUrl(list.page - 1)}>Anterior</Link></Button>}{list.page * list.pageSize < list.total && <Button asChild variant="outline"><Link to={pageUrl(list.page + 1)}>Siguiente</Link></Button>}</nav>
  </section>;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  const invalid = isRouteErrorResponse(error) && error.status === 400;
  return <ErrorState title={invalid ? "Filtros no válidos" : "No se pudieron cargar las ventas"} description={invalid ? "Revisa los filtros e inténtalo de nuevo." : "Inténtalo de nuevo."} action={<Button asChild variant="outline"><a href="?">Volver a ventas</a></Button>} />;
}
