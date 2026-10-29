import type { Money } from "@shared/money";
import type { ChatReadingContext, ReadingItem, ReadingPending, ReadingProduct } from "@core/src/features/orders/domain/chat-reading";
import type { ProductId } from "@core/src/features/products/domain/product";

/** Products with more combinations than this list only what is sold, so a rendering never grows with the cartesian product. */
const maxCombinationsEnumerated = 2000;

const moneyText = ({ amount, currency }: Money) => `${currency} ${amount.toFixed(2)}`;
const valuesText = (attributes: Readonly<Record<string, string>>) => Object.entries(attributes).map(([name, value]) => `${name} ${value}`).join(" · ");

/** One price line when every variant shares a price; otherwise the combinations grouped by price, with the currency said once when it is the same. */
const priceLines = (product: ReadingProduct): string[] => {
  const currencies = new Set(product.variants.map(({ unitPrice }) => unitPrice.currency));
  const groups = new Map<string, string[]>();
  for (const { unitPrice, variantAttributes } of product.variants) {
    const key = moneyText(unitPrice);
    groups.set(key, [...(groups.get(key) ?? []), valuesText(variantAttributes)]);
  }
  if (groups.size <= 1) return [`  Price: ${[...groups.keys()][0] ?? "none"}`];
  const [currency] = currencies;
  if (currencies.size !== 1 || !currency) return [...groups].map(([price, combinations]) => `  ${price}: ${combinations.join("; ")}`);
  return [`  Prices in ${currency}:`, ...[...groups].map(([price, combinations]) => `  ${price.slice(currency.length + 1)}: ${combinations.join("; ")}`)];
};

/** Combinations of the attribute values that no active variant covers. */
function missingCombinations(product: ReadingProduct): string[] | null {
  const size = product.attributes.reduce((total, { values }) => total * values.length, 1);
  if (product.attributes.length === 0 || size > maxCombinationsEnumerated) return null;
  const sold = new Set(product.variants.map(({ variantAttributes }) => product.attributes.map(({ name }) => variantAttributes[name]).join("\u0000")));
  let combinations: string[][] = [[]];
  for (const { name, values } of product.attributes) combinations = combinations.flatMap((prefix) => values.map((value) => [...prefix, `${name} ${value}`]));
  const keyOf = (parts: readonly string[]) => parts.map((part, index) => part.slice((product.attributes[index]?.name.length ?? 0) + 1)).join("\u0000");
  return combinations.filter((parts) => !sold.has(keyOf(parts))).map((parts) => parts.join(" · "));
}

/** Prices once when they agree, grouped otherwise; the shorter of the sold and the not sold combinations, never one line per variant. */
function productLines(product: ReadingProduct): string[] {
  if (!product.sellable) return [`${product.ref} ${product.name} — not for sale`];
  const lines = [`${product.ref} ${product.name} — for sale`, ...product.attributes.map(({ name, values }) => `  ${name}: ${values.join(", ")}`), ...priceLines(product)];
  const missing = missingCombinations(product);
  if (missing === null || missing.length === 0) return lines;
  const sold = product.variants.map(({ variantAttributes }) => valuesText(variantAttributes));
  return missing.length < sold.length ? [...lines, `  Not sold: ${missing.join("; ")}`] : [...lines, `  Sold combinations: ${sold.join("; ")}`];
}

const refOfProduct = (products: readonly ReadingProduct[]) => (productId: ProductId | null) => products.find((product) => product.productId === productId);

function itemLine(item: ReadingItem, productOf: ReturnType<typeof refOfProduct>): string {
  const product = productOf(item.productId);
  const name = product ? `${item.productName} (${product.ref})` : item.productName;
  const values = valuesText(item.variantAttributes);
  return [`${item.ref}: ${name}`, ...(values ? [values] : []), `quantity ${item.quantity}`, `${moneyText(item.unitPrice)} each`].join(" · ");
}

function pendingLine({ ref, pending }: ReadingPending, productOf: ReturnType<typeof refOfProduct>): string {
  const named = (productId: ProductId) => { const product = productOf(productId); return product ? `${product.name} (${product.ref})` : null; };
  const { subject } = pending;
  const subjectText = subject.kind === "variant"
    ? named(subject.productId) ?? "a product that is not listed"
    : `one of ${subject.candidates.map(named).filter((name): name is string => name !== null).join(", ")}`;
  const known = Object.entries(pending.known).map(([name, value]) => `${name} ${value}`).join(", ");
  const product = subject.kind === "variant" ? productOf(subject.productId) : undefined;
  const missing = product?.attributes.filter(({ name }) => !(name in pending.known)).map(({ name }) => name) ?? [];
  const price = pending.price
    ? ` Stated price: ${moneyText(pending.price.amount)} ${pending.price.per === "not_explicit" ? "basis not stated" : `per ${pending.price.per}`} (stated for ${pending.price.forQuantity} ${pending.price.forQuantity === 1 ? "unit" : "units"}).`
    : "";
  return `${ref}: ${subjectText}.${known ? ` Known: ${known}.` : ""}${missing.length ? ` Missing: ${missing.join(", ")}.` : ""} Quantity: ${pending.quantity}.${price}`;
}

const kindText: Readonly<Record<ChatReadingContext["kind"], string>> = {
  text: "Message kind: text message",
  photo_product: "Message kind: caption of a product photo",
  photo_not_product: "Message kind: caption of a photo that shows no catalog product",
};

/** The per-message context after the fixed instructions: items, pendings, products in the compact rendering, the photo and last the buyer's text. No ids, phones or order numbers: only refs. */
export function describeReadingContext(context: ChatReadingContext): string {
  const productOf = refOfProduct(context.products);
  const shown = context.products.filter((product) => product.shown).map((product) => {
    const variant = product.variants.find(({ variantId }) => variantId === product.shownVariantId);
    return `The photo shows ${product.ref} ${product.name}${variant ? `, variant ${valuesText(variant.variantAttributes) || "single"}` : ""}.`;
  });
  const photo = context.kind === "photo_not_product" ? ["The photo shows no catalog product."] : shown;
  return [
    kindText[context.kind],
    "Order items:", ...(context.items.length ? context.items.map((item) => itemLine(item, productOf)) : ["The chat has no open order."]),
    "Pendings:", ...(context.pendings.length ? context.pendings.map((pending) => pendingLine(pending, productOf)) : ["The chat has no pendings."]),
    ...photo,
    "Products:", ...(context.products.length ? context.products.flatMap(productLines) : ["No products are listed."]),
    "Buyer's message:",
    context.text ?? "(no text)",
  ].join("\n");
}
