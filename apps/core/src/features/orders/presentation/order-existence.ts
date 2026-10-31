export type OrderExistence = "exists" | "missing" | "unknown";

const checkTimeoutMs = 15000;

/** The in-doubt check of **Guardar venta**: does the order with the sale's id exist? A hanging or failed check is «unknown», never a verdict. */
export async function checkOrderExists(orderId: string, fetcher: typeof fetch = fetch): Promise<OrderExistence> {
  try {
    const response = await fetcher(`/api/orders/${encodeURIComponent(orderId)}/aggregate`, { credentials: "same-origin", cache: "no-store",
      headers: { accept: "application/json" }, signal: AbortSignal.timeout(checkTimeoutMs) });
    if (response.ok) return "exists";
    return response.status === 404 ? "missing" : "unknown";
  } catch { return "unknown"; }
}
