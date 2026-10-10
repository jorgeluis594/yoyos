import { redirect, isRouteErrorResponse, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { buyerPaymentViewSchema } from "@shared/contracts/orders";
import { orders } from "@core/src/features/orders/composition";
import { BuyerPaymentContent } from "@core/src/features/orders/presentation/buyer-payment-content";
import { bindRequestOperation, log } from "@core/src/shared/infrastructure/logger";

const privacyHeaders = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
export const headers = () => privacyHeaders;
export const meta = () => [{ title: "Pago del pedido" }, { name: "robots", content: "noindex, nofollow" }];

type Outcome = "unavailable" | "cancelled" | "technical_failure";
function fail(status: 404 | 409 | 503, outcome: Outcome): never {
  bindRequestOperation({ operation: "redirect_buyer_payment", outcome });
  throw new Response("Pedido no disponible", { status, headers: privacyHeaders });
}

export async function loader({ params }: LoaderFunctionArgs) {
  const access = await orders.resolveBuyerAccess(params.orderId ?? "");
  if (!access.success) return access.error.code === "PERSISTENCE_UNAVAILABLE" ? fail(503, "technical_failure") : fail(404, "unavailable");
  const checkout = await orders.getCheckout({ companyId: access.data.companyId, orderId: access.data.orderId });
  // getCheckout binds get_checkout; this request is still the legacy payment link.
  if (checkout.success) {
    bindRequestOperation({ operation: "redirect_buyer_payment", outcome: "redirected" });
    throw redirect(`/checkout/${access.data.companyId}/${access.data.orderId}`, { status: 301, headers: privacyHeaders });
  }
  if (checkout.error.code !== "CHECKOUT_UNAVAILABLE") {
    log.error({ event: "buyer_payment_checkout_unavailable", errorCode: checkout.error.code }, "Buyer payment checkout lookup failed");
    return fail(503, "technical_failure");
  }
  const result = await orders.getBuyerPaymentView(access.data.orderId);
  if (!result.success) {
    if (result.error.code === "ORDER_NOT_FOUND") return fail(404, "unavailable");
    if (result.error.code === "ORDER_CANCELLED") return fail(409, "cancelled");
    log.error({ event: "buyer_payment_view_unavailable", errorCode: result.error.code }, "Buyer payment view unavailable");
    return fail(503, "technical_failure");
  }
  const parsed = buyerPaymentViewSchema.safeParse(result.data);
  if (!parsed.success) {
    log.error({ event: "buyer_payment_data_invalid", errorCode: "INVALID_BUYER_PAYMENT_RESPONSE" }, "Invalid buyer payment response");
    return fail(503, "technical_failure");
  }
  bindRequestOperation({ operation: "redirect_buyer_payment", outcome: "rendered" });
  return parsed.data;
}

export default function BuyerPayment() {
  const view = useLoaderData<typeof loader>();
  return <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 px-5 py-8"><header><h1 className="text-2xl font-semibold">Pago del pedido</h1><p className="mt-2 text-muted-foreground">Elige cómo pagar y adjunta tu comprobante.</p></header><BuyerPaymentContent view={view} /></main>;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  const missing = isRouteErrorResponse(error) && error.status === 404;
  return <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-4"><span className="text-xl font-semibold">Yoyos</span><h1 className="text-2xl font-semibold">{missing ? "Pedido no encontrado" : "No se pudo cargar el pago"}</h1><p className="text-muted-foreground">{missing ? "Revisa el enlace con el vendedor." : "Inténtalo de nuevo más tarde."}</p></main>;
}
