import { redirect, isRouteErrorResponse, type LoaderFunctionArgs } from "react-router";
import { orders } from "@core/src/features/orders/composition";
import { bindRequestOperation } from "@core/src/shared/infrastructure/logger";

const privacyHeaders = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
export const headers = () => privacyHeaders;
export const meta = () => [{ title: "Pago del pedido" }, { name: "robots", content: "noindex, nofollow" }];

export async function loader({ params }: LoaderFunctionArgs) {
  const access = await orders.resolveBuyerAccess(params.orderId ?? "");
  if (access.success) {
    bindRequestOperation({ operation: "redirect_buyer_payment", outcome: "redirected" });
    throw redirect(`/checkout/${access.data.companyId}/${access.data.orderId}`, { status: 301, headers: privacyHeaders });
  }
  const unavailable = access.error.code === "PERSISTENCE_UNAVAILABLE";
  bindRequestOperation({ operation: "redirect_buyer_payment", outcome: unavailable ? "technical_failure" : "unavailable" });
  throw new Response("Pedido no disponible", { status: unavailable ? 503 : 404, headers: privacyHeaders });
}

export function ErrorBoundary({ error }: { error: unknown }) {
  const missing = isRouteErrorResponse(error) && (error.status === 404 || error.status === 400);
  return <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-4"><span className="text-xl font-semibold">Yoyos</span><h1 className="text-2xl font-semibold">{missing ? "Pedido no encontrado" : "No se pudo cargar el pago"}</h1><p className="text-muted-foreground">{missing ? "Revisa el enlace con el vendedor." : "Inténtalo de nuevo más tarde."}</p></main>;
}
