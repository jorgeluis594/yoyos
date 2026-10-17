import { useCallback, useSyncExternalStore } from "react";
import { z } from "zod";

/** Cart limits; the server enforces the same ones in `continueToCheckoutSchema`. */
export const maxCartLines = 30;
export const maxCartQuantity = 99;

const lineSchema = z.object({ variantId: z.uuid(), productId: z.uuid(), quantity: z.number().int().min(1).max(maxCartQuantity),
  /** Last price and display data the buyer saw; the order always uses the server price. */
  price: z.object({ amount: z.number(), currency: z.string() }), productName: z.string(), attributes: z.record(z.string(), z.string()),
  imageUrl: z.string().nullable() });
const cartSchema = z.object({ orderId: z.uuid(), lines: z.array(lineSchema).max(maxCartLines) });
export type CatalogCartLine = z.infer<typeof lineSchema>;
export type CatalogCart = z.infer<typeof cartSchema>;

const newOrderId = (): string => crypto.randomUUID();
export const emptyCart = (orderId = newOrderId()): CatalogCart => ({ orderId, lines: [] });

const content = (lines: readonly CatalogCartLine[]) => JSON.stringify(lines.map((line) => [line.variantId, line.quantity, line.price.amount]));
/** The order id stays while lines, quantities and shown prices stay the same, so repeating Continuar opens the same order. */
export function withLines(cart: CatalogCart, lines: CatalogCartLine[], nextId = newOrderId): CatalogCart {
  return content(lines) === content(cart.lines) ? { ...cart, lines } : { orderId: nextId(), lines };
}

export type AddToCartResult = Readonly<{ kind: "added"; cart: CatalogCart }> | Readonly<{ kind: "line_limit" }>;
/** Adding a variant already in the cart adds to its line, without passing the variant's available quantity or 99. */
export function addToCart(cart: CatalogCart, line: CatalogCartLine, maxQuantity: number, nextId = newOrderId): AddToCartResult {
  const existing = cart.lines.find((item) => item.variantId === line.variantId);
  if (!existing && cart.lines.length >= maxCartLines) return { kind: "line_limit" };
  const limit = Math.min(maxQuantity, maxCartQuantity);
  const lines = existing
    ? cart.lines.map((item) => item.variantId === line.variantId ? { ...line, quantity: Math.min(item.quantity + line.quantity, limit) } : item)
    : [...cart.lines, { ...line, quantity: Math.min(line.quantity, limit) }];
  return { kind: "added", cart: withLines(cart, lines, nextId) };
}

export const setLineQuantity = (cart: CatalogCart, variantId: string, quantity: number, nextId = newOrderId) =>
  withLines(cart, cart.lines.map((line) => line.variantId === variantId ? { ...line, quantity: Math.max(1, Math.min(quantity, maxCartQuantity)) } : line), nextId);
export const removeLine = (cart: CatalogCart, variantId: string, nextId = newOrderId) =>
  withLines(cart, cart.lines.filter((line) => line.variantId !== variantId), nextId);

type FreshVariant = Readonly<{ variantId: string; productName: string; attributes: Readonly<Record<string, string>>; price: Readonly<{ amount: number; currency: string }>; imageUrl: string | null }>;
/** Current prices replace the shown ones; a changed price is a changed cart and gets a new order id. */
export function applyRefresh(cart: CatalogCart, variants: readonly FreshVariant[], nextId = newOrderId): CatalogCart {
  const byId = new Map(variants.map((variant) => [variant.variantId, variant]));
  return withLines(cart, cart.lines.map((line) => {
    const fresh = byId.get(line.variantId);
    return fresh ? { ...line, productName: fresh.productName, attributes: { ...fresh.attributes }, price: { ...fresh.price }, imageUrl: fresh.imageUrl } : line;
  }), nextId);
}

// Storage can be blocked (private mode, some in-app browsers): the cart then lives only while the page is open.
const storageKey = (companyId: string) => `yoyos.catalog-cart.${companyId}`;
const changeEvent = "yoyos:catalog-cart";
const memory = new Map<string, string>();
const snapshots = new Map<string, Readonly<{ raw: string | null; cart: CatalogCart }>>();

function readRaw(companyId: string) {
  try { return window.localStorage.getItem(storageKey(companyId)); } catch { return memory.get(companyId) ?? null; }
}

export function readCart(companyId: string): CatalogCart {
  const raw = readRaw(companyId);
  const cached = snapshots.get(companyId);
  if (cached && cached.raw === raw) return cached.cart;
  let cart = emptyCart();
  try { const parsed = cartSchema.safeParse(raw ? JSON.parse(raw) : null); if (parsed.success) cart = parsed.data; } catch { /* corrupt cart starts empty */ }
  snapshots.set(companyId, { raw, cart });
  return cart;
}

export function writeCart(companyId: string, cart: CatalogCart) {
  const raw = JSON.stringify(cart);
  try { window.localStorage.setItem(storageKey(companyId), raw); } catch { memory.set(companyId, raw); }
  window.dispatchEvent(new Event(changeEvent));
}

/** Called by the checkout once the buyer confirms: only the cart that created that order is emptied. */
export function clearCartForOrder(companyId: string, orderId: string) {
  if (readRaw(companyId) !== null && readCart(companyId).orderId === orderId) writeCart(companyId, emptyCart());
}

function subscribe(onChange: () => void) {
  window.addEventListener(changeEvent, onChange);
  window.addEventListener("storage", onChange);
  return () => { window.removeEventListener(changeEvent, onChange); window.removeEventListener("storage", onChange); };
}

const serverCart = emptyCart("00000000-0000-4000-8000-000000000000");
/** The cart of this business in this browser, shared by every component that shows or edits it. */
export function useCatalogCart(companyId: string) {
  const cart = useSyncExternalStore(subscribe, () => readCart(companyId), () => serverCart);
  const update = useCallback((next: CatalogCart) => writeCart(companyId, next), [companyId]);
  return [cart, update] as const;
}
