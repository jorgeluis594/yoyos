import { redirect, isRouteErrorResponse, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { buyerPaymentViewSchema } from "@shared/contracts/orders";
import { orders } from "@core/src/features/orders/composition";
import { BuyerPaymentContent } from "@core/src/features/orders/presentation/buyer-payment-content";
export const headers = () => ({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
export const meta = () => [{ title: "Pago del pedido" }, { name: "robots", content: "noindex, nofollow" }];
export async function loader({ params }: LoaderFunctionArgs) {
  const result = await orders.getBuyerPaymentView(params.orderId ?? "");
  if (!result.success && result.error.code === "CHECKOUT_UNAVAILABLE") {
    const access = await orders.resolveBuyerAccess(params.orderId ?? "");
    if (access.success) throw redirect(`/checkout/${access.data.companyId}/${access.data.orderId}`);
  }
  if (!result.success) throw new Response("Pedido no disponible", { status: result.error.code === "ORDER_NOT_FOUND" ? 404 :
    result.error.code === "INVALID_ORDER" ? 400 : result.error.code === "ORDER_CANCELLED" ? 409 : 503 });
  return buyerPaymentViewSchema.parse(result.data);
}

export default function BuyerPayment() {
  const view = useLoaderData<typeof loader>();
  return <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 px-5 py-8"><header><h1 className="text-2xl font-semibold">Pago del pedido</h1><p className="mt-2 text-muted-foreground">Elige cómo pagar y adjunta tu comprobante.</p></header><BuyerPaymentContent view={view} /></main>;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  const missing = isRouteErrorResponse(error) && (error.status === 404 || error.status === 400);
  return <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-4"><span className="text-xl font-semibold">Yoyos</span><h1 className="text-2xl font-semibold">{missing ? "Pedido no encontrado" : "No se pudo cargar el pago"}</h1><p className="text-muted-foreground">{missing ? "Revisa el enlace con el vendedor." : "Inténtalo de nuevo más tarde."}</p></main>;
}
