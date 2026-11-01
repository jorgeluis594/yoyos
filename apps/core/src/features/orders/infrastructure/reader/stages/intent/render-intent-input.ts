import { defaultReadingBudgets } from "@core/src/features/orders/domain/reader/budgets";
import type { ReadingContextMessage, ReadingInput, ReadingItem, ReadingPending } from "@core/src/features/orders/domain/reader/readings";

/**
 * Each element costs its text plus at most the fixed characters `readingInputChars` accounts for (frame included), so an input that
 * fitted the size model, whatever budget it was fitted to, renders within it. The default budget is enforced here as a backstop, on the
 * real rendered text, in the fixed cut order.
 */
/** Line breaks of a message become ⏎, so buyer text cannot start a line that looks like part of the structure. */
const flat = (text: string) => text.replace(/\r\n|[\n\r\u0085\u2028\u2029]/g, "⏎");
const attributesText = (attributes: Readonly<Record<string, string>>) => Object.entries(attributes).map(([name, value]) => ` · ${flat(name)} ${flat(value)}`).join("");

const contextLine = (message: ReadingContextMessage) =>
  `${message.ref} (${message.direction === "incoming" ? "buyer" : "seller"}, ${message.masked ? "masked" : "unmasked"}, ${message.kind}): ${message.text === null ? "(no text)" : flat(message.text)}`;
const itemLine = (item: ReadingItem) => `${item.ref}: ${flat(item.productName)}${attributesText(item.variantAttributes)} · quantity ${item.quantity}`;
const pendingLine = (pending: ReadingPending) => {
  const subject = pending.productIds.length > 1 ? `a choice between ${pending.productIds.length} products` : "one product";
  return `${pending.ref}: ${subject}${attributesText(pending.known).replace(/^ · /, " · known: ")} · quantity ${pending.quantity}${pending.doubtful ? " · in doubt" : ""}`;
};

function photoLines({ current, photo, photoMemory }: ReadingInput): string[] {
  const shown = photo === null ? [] : [photo.productId === null ? "The photo shows no catalog product." : "The photo shows a catalog product."];
  const previous = photoMemory === null ? [] : [photoMemory.left === null ? "The buyer's previous message was a photo that left nothing."
    : `The buyer's previous message was a photo that left ${photoMemory.left.kind === "pending" ? "a pending" : "an item in the order"}.`];
  return [`Message kind: ${current.kind === "image" ? "caption of a photo" : "text message"}`, ...shown, ...previous];
}

/**
 * What the intent stage reads after its fixed instructions: the photo facts, recent messages oldest first with direction, ref and mask
 * flag, the order lines, the pendings and last the buyer's message. Only refs, never ids. The result stays within `maxChars` unless the frame alone exceeds it: the oldest
 * context messages go first, then what is left is filled by priority (current message, order lines newest first, pendings).
 */
export function renderIntentInput(input: ReadingInput, maxChars: number = defaultReadingBudgets.stageInputMaxChars): string {
  const head = photoLines(input);
  const tail = ["Buyer's message:", input.current.text === "" ? "(no text)" : flat(input.current.text)];
  const assemble = (context: readonly string[], items: readonly string[], pendings: readonly string[]) => [
    ...head,
    "Recent messages, oldest first:", ...(context.length ? context : ["No recent messages are listed."]),
    "Order lines:", ...(items.length ? items : ["No order lines are listed."]),
    "Pendings:", ...(pendings.length ? pendings : ["No pendings are listed."]),
    ...tail,
  ].join("\n");

  const context = input.context.map(contextLine);
  const items = input.items.map(itemLine);
  const pendings = input.pendings.map(pendingLine);
  let keptContext = context;
  while (keptContext.length > 0 && assemble(keptContext, items, pendings).length > maxChars) keptContext = keptContext.slice(1);
  if (assemble(keptContext, items, pendings).length <= maxChars) return assemble(keptContext, items, pendings);

  let remaining = maxChars - assemble([], [], []).length;
  const fit = (lines: readonly string[]) => lines.map((line) => { const fits = line.length + 1 <= remaining; if (fits) remaining -= line.length + 1; return fits; });
  const itemFits = fit([...items].reverse()).reverse();
  const pendingFits = fit(pendings);
  return assemble([], items.filter((_, index) => itemFits[index]), pendings.filter((_, index) => pendingFits[index]));
}
