import type { ChatContextItem, ChatToolContext } from "@core/src/features/orders/application/chat-tool-types";

const itemLine = (item: ChatContextItem) => `${item.label}: ${item.productName}${variantText(item.variantAttributes)}, quantity ${item.quantity}, unit price ${item.unitPrice.amount} ${item.unitPrice.currency}`;
const variantText = (attributes: Readonly<Record<string, string>>) => Object.keys(attributes).length ? ` (${Object.entries(attributes).map(([name, value]) => `${name}: ${value}`).join(", ")})` : "";

/** The only context the models get besides the message: the open order and, for a photo, the product it shows as text, or that it shows none. */
export function describeChatContext({ items, shown, kind }: ChatToolContext): string {
  const order = items.length ? items.map(itemLine).join("\n") : "The chat has no open order.";
  const photo = shown.map(({ product }) => `The photo shows ${product.name}. Variants: ${product.variants.map((variant) => Object.values(variant.variantAttributes).join(" ") || "single variant").join("; ")}.`);
  const notProduct = kind === "photo_not_product" ? ["The photo does not show a catalog product."] : [];
  return ["Open order items:", order, ...photo, ...notProduct].join("\n");
}
