import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Link, useLocation } from "react-router";
import { Minus, Plus, ShoppingBag } from "lucide-react";
import { Alert, AlertAction, AlertDescription } from "@core/app/components/ui/alert";
import { ProductThumbnail } from "@core/src/features/store-appearance/presentation/product-thumbnail";
import { Button } from "@core/app/components/ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "@core/app/components/ui/empty";
import { Sheet, SheetClose, SheetContent, SheetTrigger } from "@core/app/components/ui/sheet";
import { formatCurrency } from "@core/app/format-currency";
import { cn } from "@core/app/lib/utils";
import { clearCartForOrder, emptyCart, markContinued, removeLine, setLineQuantity, applyRefresh, readCart, useCatalogCart, type CatalogCart, type CatalogCartLine } from "@core/app/lib/catalog-cart-storage";
import { attributesLabel } from "@core/app/lib/variant-attributes-label";
import type { CartRefreshResponse, CheckOrderResponse, ContinueResponse } from "@core/app/routes/catalog-cart";

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
  : issue.reason === "other_currency" ? "No se puede pedir junto con los demás productos" : issue.available === 1 ? "Solo queda 1" : `Solo quedan ${issue.available}`;

const cartRoute = "/carrito";

let orderChecked = false;
/** Lets a test mount the storefront again as a new document load. */
export function resetOrderCheck() { orderChecked = false; }

/** Asks core whether the order the cart sent to Continuar was confirmed in the checkout; any failure leaves the cart as it is. */
async function checkOrder(companyId: string, orderId: string) {
  try {
    const response = await fetch(cartRoute, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent: "check_order", orderId }) });
    if (!response.ok) return;
    const body = await response.json() as CheckOrderResponse;
    if ("order" in body && body.order === "confirmed") clearCartForOrder(companyId, orderId);
  } catch { /* offline, rate-limited or a bad answer: the next document load or restored page asks again */ }
}

/**
 * Once per document load, and again when the back button restores a bfcache page, empties the cart whose order was confirmed.
 * Only a cart with lines whose current order id was already sent to Continuar asks, so a buyer who never continued sends nothing.
 */
function useConfirmedOrderCheck(companyId: string) {
  useEffect(() => {
    const ask = () => {
      const cart = readCart(companyId);
      if (cart.continued && cart.lines.length) void checkOrder(companyId, cart.orderId);
    };
    if (!orderChecked) { orderChecked = true; ask(); }
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) ask(); };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [companyId]);
}

/** The buyer's cart inside the cart sheet: refreshes prices on open and turns into an order with **Continuar**, through the `/carrito` resource route of the brand host. */
export function CatalogCartPanel({ companyId, catalogPath }: Readonly<{ companyId: string; catalogPath: string }>) {
  const [cart, update] = useCatalogCart(companyId);
  const { pathname } = useLocation();
  const [maxQuantities, setMaxQuantities] = useState<ReadonlyMap<string, number>>(new Map());
  const [issues, setIssues] = useState<ReadonlyMap<string, LineIssue>>(new Map());
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const [removed, setRemoved] = useState<CatalogCart | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const route = cartRoute;
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

  const edit = (line: CatalogCartLine, next: CatalogCart) => {
    setFailure(null);
    setIssues((current) => { const without = new Map(current); without.delete(line.variantId); return without; });
    update(next);
  };
  const remove = (line: CatalogCartLine) => {
    setRemoved(cart);
    edit(line, removeLine(cart, line.variantId));
    clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setRemoved(null), 5000);
  };

  async function continueToCheckout(current: CatalogCart, retried = false): Promise<void> {
    if (!navigator.onLine) { setFailure("offline"); return; }
    let response: Response;
    try {
      response = await fetch(route, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "continue", orderId: current.orderId, lines: current.lines.map(({ variantId, quantity }) => ({ variantId, quantity })) }) });
    } catch { setFailure("in_doubt"); return; }
    const body = await response.json().catch(() => null) as ContinueResponse | null;
    // The checkout lives on the app host, so the whole URL is needed; the flag lets this page ask later whether it was confirmed.
    if (body && "checkoutUrl" in body) { markContinued(companyId, current.orderId); window.location.assign(body.checkoutUrl); return; }
    if (body?.code === "ORDER_ID_CONFLICT" && !retried) {
      const fresh = { lines: current.lines, orderId: emptyCart().orderId };
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
    {/* On the catalog itself, closing the sheet is enough and keeps the buyer's search. */}
    <SheetClose asChild>{pathname === catalogPath ? <Button>Ver productos</Button> : <Button asChild><Link to={catalogPath}>Ver productos</Link></Button>}</SheetClose></Empty></div>;
  const currency = cart.lines[0].price.currency;
  const subtotal = cart.lines.reduce((sum, line) => sum + Math.round(line.price.amount * 100) * line.quantity, 0) / 100;
  return <div className="flex flex-col gap-4">
    {undo}
    <ul className="flex flex-col divide-y">
      {cart.lines.map((line) => {
        const issue = issues.get(line.variantId);
        const max = Math.min(maxQuantities.get(line.variantId) ?? 99, 99);
        const variant = attributesLabel(line.attributes);
        return <li key={line.variantId} data-store-part="cart-line" className="flex gap-3 py-3">
          <ProductThumbnail name={line.productName} url={line.imageUrl} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p data-store-part="product-name" className="line-clamp-2 font-medium">{line.productName}</p>
            {variant && <p className="text-sm text-muted-foreground">{variant}</p>}
            {issue && <p className="text-sm font-medium text-destructive">{issueText(issue)}</p>}
            <p className="text-sm text-muted-foreground tabular-nums">{money(line.price.amount, line.price.currency)} c/u</p>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1" role="group" aria-label={`Cantidad de ${line.productName}`}>
                <Button variant="outline" size="icon" aria-label="Quitar una unidad" disabled={line.quantity <= 1} onClick={() => edit(line, setLineQuantity(cart, line.variantId, line.quantity - 1))}><Minus aria-hidden="true" /></Button>
                <span className="min-w-8 text-center tabular-nums" aria-live="polite">{line.quantity}</span>
                <Button variant="outline" size="icon" aria-label="Agregar una unidad" disabled={line.quantity >= max} onClick={() => edit(line, setLineQuantity(cart, line.variantId, line.quantity + 1))}><Plus aria-hidden="true" /></Button>
              </div>
              <strong data-store-part="price" className="tabular-nums">{money(Math.round(line.price.amount * 100) * line.quantity / 100, line.price.currency)}</strong>
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
  </div>;
}

/** The look of the **Carrito** button: bag, label and unit count. Presentational, so the editor preview can draw it without a cart. */
export function CatalogCartButtonFace({ units, className, ...props }: Readonly<{ units: number } & Omit<ComponentProps<typeof Button>, "children">>) {
  const unitsText = `${units} ${units === 1 ? "unidad" : "unidades"}`;
  return <Button data-store-part="cart-button" size="lg" className={cn("fixed right-4 bottom-4 z-40 h-12 shadow-lg", className)} aria-label={`Carrito, ${unitsText}`} {...props}>
    <ShoppingBag aria-hidden="true" />Carrito{units > 0 && <span className="rounded-full bg-background px-2 text-xs font-semibold text-foreground tabular-nums">{units}</span>}
  </Button>;
}

/** Fixed **Carrito** button with the unit count; opens the cart in a side sheet. Render it inside `CatalogShell`: the sheet portals next to the button so it keeps the store theme. */
export function CatalogCartButton({ companyId }: Readonly<{ companyId: string }>) {
  const [cart] = useCatalogCart(companyId);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const units = cart.lines.reduce((sum, line) => sum + line.quantity, 0);
  const unitsText = `${units} ${units === 1 ? "unidad" : "unidades"}`;
  useConfirmedOrderCheck(companyId);
  return <Sheet>
    <div ref={setHost} data-store-part="cart-sheet" />
    <SheetTrigger asChild><CatalogCartButtonFace units={units} /></SheetTrigger>
    <SheetContent title="Carrito" description={unitsText} container={host}>
      <div className="flex-1 overflow-y-auto p-5">
        <CatalogCartPanel companyId={companyId} catalogPath="/" />
      </div>
    </SheetContent>
  </Sheet>;
}
