import { afterEach, expect, test, vi } from "vitest";
import { addToCart, applyRefresh, clearCartForOrder, emptyCart, markContinued, readCart, removeLine, setLineQuantity, writeCart, type CatalogCartLine } from "@core/app/lib/catalog-cart-storage";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ids = () => { let n = 100; return () => id(n++); };
const line = (variantId: string, quantity: number, amount = 45): CatalogCartLine => ({ variantId, productId: id(9), quantity,
  price: { amount, currency: "PEN" }, productName: "Polo básico", attributes: { Talla: "M", Color: "Negro" }, imageUrl: null });
const added = (result: ReturnType<typeof addToCart>) => { if (result.kind !== "added") throw new Error(result.kind); return result.cart; };

afterEach(() => vi.unstubAllGlobals());

test("adding the same variant twice keeps one line and the order id changes only when the cart changes", () => {
  const nextId = ids();
  const first = added(addToCart(emptyCart(id(1)), line(id(3), 2), 3, nextId));
  const cart = added(addToCart(first, line(id(3), 1), 3, nextId));
  expect(cart.lines).toEqual([line(id(3), 3)]);
  expect(cart.lines.reduce((sum, item) => sum + item.price.amount * item.quantity, 0)).toBe(135);
  expect(cart.orderId).not.toBe(first.orderId);
  expect(addToCart(cart, line(id(3), 1), 3, nextId)).toEqual({ kind: "at_limit" });
  expect(setLineQuantity(cart, id(3), 3, nextId)).toEqual(cart);
  expect(setLineQuantity(cart, id(3), 2, nextId).orderId).not.toBe(cart.orderId);
  expect(removeLine(cart, id(3), nextId).lines).toEqual([]);
});

test("an add that passes the available quantity is clamped and says so", () => {
  const cart = added(addToCart(emptyCart(id(1)), line(id(3), 2), 3));
  const result = addToCart(cart, line(id(3), 2), 3);
  expect(result).toMatchObject({ kind: "added", clamped: true });
  expect(added(result).lines[0].quantity).toBe(3);
  expect(addToCart(cart, line(id(3), 1), 3)).toMatchObject({ kind: "added", clamped: false });
  expect(addToCart(emptyCart(id(1)), line(id(3), 120), 200)).toMatchObject({ kind: "added", clamped: true });
});

test("refreshing keeps the order id unless a shown price changed", () => {
  const nextId = ids();
  const cart = { orderId: id(1), lines: [line(id(3), 2)] };
  const fresh = (amount: number) => [{ variantId: id(3), productName: "Polo básico", attributes: { Talla: "M", Color: "Negro" }, price: { amount, currency: "PEN" }, imageUrl: null }];
  expect(applyRefresh(cart, fresh(45), nextId).orderId).toBe(id(1));
  expect(applyRefresh(cart, fresh(50), nextId)).toEqual({ orderId: id(100), lines: [line(id(3), 2, 50)] });
});

test("a cart holds at most 30 distinct products", () => {
  const cart = { orderId: id(1), lines: Array.from({ length: 30 }, (_, index) => line(id(200 + index), 1)) };
  expect(addToCart(cart, line(id(3), 1), 5).kind).toBe("line_limit");
  expect(addToCart(cart, line(id(200), 1), 5).kind).toBe("added");
});

test("the cart survives a reload and is emptied only by the confirmation of its own order", () => {
  const stored = new Map<string, string>();
  vi.stubGlobal("window", Object.assign(new EventTarget(), { localStorage: {
    getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) } }));
  const cart = { orderId: id(1), lines: [line(id(3), 2), line(id(4), 1)] };
  writeCart(id(7), cart);
  expect(readCart(id(7))).toEqual(cart);
  clearCartForOrder(id(7), id(2));
  expect(readCart(id(7))).toEqual(cart);
  clearCartForOrder(id(7), id(1));
  expect(readCart(id(7)).lines).toEqual([]);
});

function stubStorage() {
  const stored = new Map<string, string>();
  vi.stubGlobal("window", Object.assign(new EventTarget(), { localStorage: {
    getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) } }));
  return stored;
}

test("clears the cart when the storefront learns its order was confirmed and keeps another order's cart", () => {
  stubStorage();
  const cart = { orderId: id(1), lines: [line(id(3), 2)], continued: true };
  writeCart(id(8), cart);
  clearCartForOrder(id(8), id(2));
  expect(readCart(id(8))).toEqual(cart);
  clearCartForOrder(id(8), id(1));
  expect(readCart(id(8))).toMatchObject({ lines: [] });
  expect(readCart(id(8)).continued).toBeFalsy();
  expect(readCart(id(8)).orderId).not.toBe(id(1));
});

test("drops the continued flag when the cart content changes its order id", () => {
  const nextId = ids();
  const continued = { orderId: id(1), lines: [line(id(3), 2)], continued: true };
  expect(setLineQuantity(continued, id(3), 2, nextId)).toEqual(continued);
  expect(setLineQuantity(continued, id(3), 1, nextId)).toEqual({ orderId: id(100), lines: [line(id(3), 1)] });
  expect(removeLine(continued, id(3), nextId).continued).toBeUndefined();
  expect(added(addToCart(continued, line(id(4), 1), 5, nextId)).continued).toBeUndefined();
  expect(applyRefresh(continued, [{ variantId: id(3), productName: "Polo básico", attributes: { Talla: "M", Color: "Negro" }, price: { amount: 50, currency: "PEN" }, imageUrl: null }], nextId).continued).toBeUndefined();
});

test("marks only the cart that holds the order as continued, and carts stored before the flag read as not continued", () => {
  const stored = stubStorage();
  stored.set(`yoyos.catalog-cart.${id(9)}`, JSON.stringify({ orderId: id(1), lines: [line(id(3), 2)] }));
  expect(readCart(id(9)).continued).toBeFalsy();
  markContinued(id(9), id(2));
  expect(readCart(id(9)).continued).toBeFalsy();
  markContinued(id(9), id(1));
  expect(readCart(id(9))).toMatchObject({ orderId: id(1), continued: true });
});
