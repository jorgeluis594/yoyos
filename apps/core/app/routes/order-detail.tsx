import { isRouteErrorResponse, Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { privateUserContext } from "@core/app/private-user-context";
import { orders } from "@core/src/features/orders/composition";
import { toOrderAggregateJson } from "@core/src/features/orders/presentation/order-json";
import { orderDetailLoaderSchema } from "@shared/contracts/orders";
import type { OrderId } from "@core/src/features/orders/domain/order";
import { Button } from "@core/app/components/ui/button";
import { ErrorState } from "@core/app/components/ui/error-state";

export async function loader({ params, context }: LoaderFunctionArgs) {
  const access = context.get(privateUserContext);
  const result = await orders.getAggregate((params.orderId ?? "") as OrderId,
    { companyId: access.company.id, userId: access.user.id });
  if (!result.success) throw new Response(result.error.message, { status: result.error.code === "ORDER_NOT_FOUND" ? 404 : result.error.code === "INVALID_ORDER" ? 400 : 503 });
  return orderDetailLoaderSchema.parse({ order: toOrderAggregateJson(result.data), base: `/es-${access.company.country}/orders` });
}

export default function OrderDetail() {
  const { order, base } = useLoaderData<typeof loader>();
  const amount = (money: typeof order.total) => `${money.amount.toFixed(2)} ${money.currency}`;
  const status = order.status === "completed" ? "Venta completada" : order.status === "cancelled" ? "Orden cancelada" : "Orden activa";
  return <section className="space-y-6"><header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">{status}</h1><p className="text-muted-foreground">Creada el {new Date(order.createdAt).toLocaleString("es-PE")}</p>{order.completedAt && <p className="text-muted-foreground">Completada el {new Date(order.completedAt).toLocaleString("es-PE")}</p>}</div><Button asChild variant="outline"><Link to={base}>Ver ventas</Link></Button></header>
    <dl className="grid gap-3 rounded-md border p-5 sm:grid-cols-2"><div><dt className="text-sm text-muted-foreground">Cliente</dt><dd>{order.customer.kind === "contact" ? order.customer.name ?? order.customer.phone : "Público general"}</dd></div><div><dt className="text-sm text-muted-foreground">Pago</dt><dd>{order.paymentStatus === "paid" ? "Cubierto" : `Pendiente: ${amount(order.balanceDue)}`}</dd></div>{order.customer.kind === "contact" && <div><dt className="text-sm text-muted-foreground">Teléfono al vender</dt><dd>{order.customer.phone}</dd></div>}<div><dt className="text-sm text-muted-foreground">Entrega</dt><dd>{order.deliveryStatus === "delivered" ? "Entregada" : order.deliveryStatus === "shipped" ? "Despachada" : "Pendiente"}</dd></div><div><dt className="text-sm text-muted-foreground">Stock</dt><dd>{order.stockDeducted ? "Descontado" : "Pendiente"}</dd></div><div><dt className="text-sm text-muted-foreground">Vendedor</dt><dd>{order.sellerId}</dd></div></dl>
    {order.delivery && <div className="rounded-md border p-5"><h2 className="font-semibold">Destinatario</h2><p>{order.delivery.recipient.name} · {order.delivery.recipient.phone}</p>{order.delivery.recipient.identity.kind === "document" && <p>{order.delivery.recipient.identity.documentType}: {order.delivery.recipient.identity.document}</p>}</div>}
    <ul className="divide-y rounded-md border">{order.items.map((item) => <li key={item.id} className="flex justify-between gap-3 p-4"><div><p className="font-medium">{item.productName}</p><p className="text-sm text-muted-foreground">{Object.values(item.variantAttributes).join(" · ") || item.sku || "Variante única"} · {item.quantity} × {amount(item.unitPrice)}</p></div><strong>{amount(item.subtotal)}</strong></li>)}</ul>
    <p className="text-right text-xl font-semibold">Total: {amount(order.total)}</p>
    {order.deliveryCharge.amount > 0 && <p className="text-right">Cargo de entrega: {amount(order.deliveryCharge)}</p>}
    {order.overpaidAmount.amount > 0 && <p className="text-right">Exceso recibido: {amount(order.overpaidAmount)}</p>}
    {order.payments.length > 0 && <section><h2 className="font-semibold">Pagos</h2><ul>{order.payments.map((payment) => <li key={payment.id}>{amount(payment.amount)} · {new Date(payment.recordedAt).toLocaleString("es-PE")}</li>)}</ul></section>}
  </section>;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  const missing = isRouteErrorResponse(error) && error.status === 404;
  return <ErrorState title={missing ? "Venta no encontrada" : "No se pudo cargar la venta"} description={missing ? "La venta no está disponible en esta empresa." : "Inténtalo de nuevo."} action={<Button asChild variant="outline"><a href="../">Ver ventas</a></Button>} />;
}
