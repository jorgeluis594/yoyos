import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Minus, Plus, ShoppingBag } from "lucide-react";
import { Alert, AlertAction, AlertDescription } from "@core/app/components/ui/alert";
import { Button } from "@core/app/components/ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "@core/app/components/ui/empty";
import { formatCurrency } from "@core/app/format-currency";
import { emptyCart, removeLine, setLineQuantity, applyRefresh, readCart, useCatalogCart, type CatalogCart, type CatalogCartLine } from "@core/app/lib/catalog-cart-storage";
import type { CartRefreshResponse, ContinueResponse } from "@core/app/routes/catalog-cart";

type LineIssue = Extract<ContinueResponse, { code: "LINES_UNAVAILABLE" }>["issues"][number];
type Failure = "lines" | "closed" | "offline" | "in_doubt" | "rate_limited" | "failed";
const failures: Record<Failure, string> = {
  lines: "Algunos productos ya no están disponibles. Quítalos para continuar",
  closed: "Esta tienda ya no está recibiendo pedidos por el catálogo",
  offline: "No pudimos continuar. Revisa tu conexión",
  in_doubt: "No sabemos si tu pedido se creó. Vuelve a intentar: no se duplicará",
  rate_limited: "Hiciste muchos pedidos seguidos. Espera unos minutos y vuelve a intentar",
  failed: "No pudimos continuar. Vuelve a intentar",
};
const money = (amount: number, currency: string) => formatCurrency(amount, currency, "es");
const issueText = (issue: LineIssue) => issue.reason === "sold_out" ? "Se agotó" : issue.reason === "unavailable" ? "Ya no está disponible"
  : issue.available === 1 ? "Solo queda 1" : `Solo quedan ${issue.available}`;

/** The buyer's cart: refreshes prices on open and turns into an order with **Continuar**, through the `catalogo/:companyId/carrito` resource route. */
export function CatalogCartPanel({ companyId, catalogPath }: Readonly<{ companyId: string; catalogPath: string }>) {
  const [cart, update] = useCatalogCart(companyId);
  const [maxQuantities, setMaxQuantities] = useState<ReadonlyMap<string, number>>(new Map());
  const [issues, setIssues] = useState<ReadonlyMap<string, LineIssue>>(new Map());
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const [removed, setRemoved] = useState<CatalogCart | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const route = `/catalogo/${companyId}/carrito`;
  const variantIds = cart.lines.map((line) => line.variantId).join(",");

  useEffect(() => {
    if (!variantIds) return;
    const controller = new AbortController();
    fetch(`${route}?${new URLSearchParams({ v: variantIds })}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const { variants } = await response.json() as CartRefreshResponse;
        setMaxQuantities(new Map(variants.map((variant) => [variant.variantId, variant.maxQuantity])));
        update(applyRefresh(readCart(companyId), variants));
      })
      // Offline or failed refresh: the cart keeps the prices last seen; Continuar always uses current ones.
      .catch(() => undefined);
    return () => controller.abort();
  }, [companyId, route, update, variantIds]);
  useEffect(() => () => clearTimeout(undoTimer.current), []);

  const edit = (next: CatalogCart) => { setFailure(null); update(next); };
  const remove = (line: CatalogCartLine) => {
    setRemoved(cart);
    setIssues((current) => { const next = new Map(current); next.delete(line.variantId); return next; });
    edit(removeLine(cart, line.variantId));
    clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setRemoved(null), 5000);
  };

  async function continueToCheckout(current: CatalogCart, retried = false): Promise<void> {
    if (!navigator.onLine) { setFailure("offline"); return; }
    let response: Response;
    try {
      response = await fetch(route, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: current.orderId, lines: current.lines.map(({ variantId, quantity }) => ({ variantId, quantity })) }) });
    } catch { setFailure("in_doubt"); return; }
    const body = await response.json().catch(() => null) as ContinueResponse | null;
    if (body && "checkoutUrl" in body) { window.location.assign(new URL(body.checkoutUrl).pathname); return; }
    if (body?.code === "ORDER_ID_CONFLICT" && !retried) {
      const fresh = { ...current, orderId: emptyCart().orderId };
      update(fresh);
      return continueToCheckout(fresh, true);
    }
    if (body?.code === "LINES_UNAVAILABLE") {
      setIssues(new Map(body.issues.map((issue) => [issue.variantId, issue])));
      setFailure("lines");
    } else setFailure(body?.code === "CATALOG_UNAVAILABLE" ? "closed" : body?.code === "RATE_LIMITED" ? "rate_limited" : "failed");
  }
  const submit = async () => {
    setBusy(true);
    setFailure(null);
    try { await continueToCheckout(cart); } finally { setBusy(false); }
  };

  const undo = removed && <Alert><AlertDescription>Producto quitado</AlertDescription>
    <AlertAction><Button variant="outline" size="sm" onClick={() => { update(removed); setRemoved(null); }}>Deshacer</Button></AlertAction></Alert>;
  if (!cart.lines.length) return <div className="flex flex-col gap-4">{undo}<Empty><EmptyHeader><EmptyTitle>Tu carrito está vacío</EmptyTitle></EmptyHeader>
    <Button asChild><Link to={catalogPath}>Ver productos</Link></Button></Empty></div>;
  const currency = cart.lines[0].price.currency;
  const subtotal = cart.lines.reduce((sum, line) => sum + Math.round(line.price.amount * 100) * line.quantity, 0) / 100;
  return <section aria-labelledby="catalog-cart-title" className="flex flex-col gap-4">
    <h2 id="catalog-cart-title" className="text-lg font-semibold">Carrito</h2>
    {undo}
    <ul className="flex flex-col divide-y">
      {cart.lines.map((line) => {
        const issue = issues.get(line.variantId);
        const max = Math.min(maxQuantities.get(line.variantId) ?? 99, 99);
        const variant = Object.values(line.attributes).join(" · ");
        return <li key={line.variantId} className="flex gap-3 py-3">
          {line.imageUrl
            ? <img src={line.imageUrl} alt="" className="size-16 shrink-0 rounded-md object-cover" />
            : <span aria-hidden="true" className="flex size-16 shrink-0 items-center justify-center rounded-md bg-muted text-lg font-semibold text-muted-foreground">{line.productName.trim().charAt(0).toUpperCase()}</span>}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="line-clamp-2 font-medium">{line.productName}</p>
            {variant && <p className="text-sm text-muted-foreground">{variant}</p>}
            {issue && <p className="text-sm font-medium text-destructive">{issueText(issue)}</p>}
            <p className="text-sm text-muted-foreground tabular-nums">{money(line.price.amount, line.price.currency)} c/u</p>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1" role="group" aria-label={`Cantidad de ${line.productName}`}>
                <Button variant="outline" size="icon" aria-label="Quitar una unidad" disabled={line.quantity <= 1} onClick={() => edit(setLineQuantity(cart, line.variantId, line.quantity - 1))}><Minus aria-hidden="true" /></Button>
                <span className="min-w-8 text-center tabular-nums" aria-live="polite">{line.quantity}</span>
                <Button variant="outline" size="icon" aria-label="Agregar una unidad" disabled={line.quantity >= max} onClick={() => edit(setLineQuantity(cart, line.variantId, line.quantity + 1))}><Plus aria-hidden="true" /></Button>
              </div>
              <strong className="tabular-nums">{money(Math.round(line.price.amount * 100) * line.quantity / 100, line.price.currency)}</strong>
            </div>
            <Button variant="link" className="w-fit px-0" onClick={() => remove(line)}>Quitar</Button>
          </div>
        </li>;
      })}
    </ul>
    <div className="flex flex-col gap-1 border-t pt-4">
      <p className="flex justify-between font-semibold"><span>Subtotal de productos:</span><span className="tabular-nums">{money(subtotal, currency)}</span></p>
      <p className="text-sm text-muted-foreground">El envío se calcula en el siguiente paso</p>
    </div>
    {failure && <Alert variant="destructive"><AlertDescription>{failures[failure]}</AlertDescription>
      {(failure === "offline" || failure === "in_doubt" || failure === "failed") && <AlertAction><Button variant="outline" size="sm" disabled={busy} onClick={() => void submit()}>Reintentar</Button></AlertAction>}</Alert>}
    <Button size="lg" disabled={busy} aria-busy={busy} onClick={() => void submit()}><ShoppingBag aria-hidden="true" />{busy ? "Continuando…" : "Continuar"}</Button>
  </section>;
}
