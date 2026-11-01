import { defaultReadingBudgets } from "@core/src/features/orders/domain/reader/budgets";
import type { ExtractionInput } from "@core/src/features/orders/infrastructure/reader/runtime/stage-version";
import { photoLeftText, pendingLines } from "@core/src/features/orders/infrastructure/reader/stages/render-pending";
import type { ReadingContextMessage, ReadingInput, ReadingItem, RequestIntent } from "@core/src/features/orders/domain/reader/readings";

/** The quote of an intent is shown up to this long: it only points at where the request is. */
const maxIntentQuoteChars = 200;

const attributesText = (attributes: Readonly<Record<string, string>>) => Object.entries(attributes).map(([name, value]) => ` · ${name} ${value}`).join("");
const contextLine = (message: ReadingContextMessage) => `${message.ref} (${message.direction === "incoming" ? "buyer" : "seller"}, ${message.kind}): ${message.text ?? "(no text)"}`;
const itemLine = (item: ReadingItem) => `${item.ref}: ${item.productName}${attributesText(item.variantAttributes)} · quantity ${item.quantity}`;
const intentLine = ({ id, kind, quote }: RequestIntent) =>
  `${id} (${kind}): «${quote.text.slice(0, maxIntentQuoteChars)}»${quote.source === "context" ? ` in ${quote.ref}` : ""}`;

/** The languages of the buyers the reader serves (Spanish and Portuguese): the shop's currency is named in each, from the platform's locale data and not from a word list. */
const currencyLocales = ["es", "pt"] as const;

/** The currency's names, singular and plural, in each buyer language and without repeats: «sol peruano», «soles peruanos». */
export function currencyNames(currency: string): readonly string[] {
  const names = currencyLocales.flatMap((locale) => [1, 2].map((amount) => {
    try {
      return new Intl.NumberFormat(locale, { style: "currency", currency, currencyDisplay: "name" }).formatToParts(amount).find((part) => part.type === "currency")?.value;
    } catch { return undefined; }
  }));
  return [...new Set(names.filter((name): name is string => name !== undefined && name !== currency))];
}

function photoLines(input: ReadingInput): string[] {
  const { current, photo, photoMemory, currency } = input;
  const shown = photo === null ? [] : [photo.productId === null ? "The photo shows no catalog product." : "The photo shows a catalog product."];
  const previous = photoMemory === null ? [] : [photoMemory.left === null ? "The buyer's previous message was a photo that left nothing."
    : `The buyer's previous message was a photo that left ${photoLeftText(input)}.`];
  const names = currency ? currencyNames(currency) : [];
  const shop = currency ? [`Prices of this shop are in ${currency}${names.length ? ` (${names.join(", ")})` : ""}.`] : [];
  return [`Message kind: ${current.kind === "image" ? "caption of a photo" : "text message"}`, ...shown, ...previous, ...shop];
}

/**
 * What the extraction stage reads after its fixed instructions: the requests to extract, the photo facts, recent messages oldest first,
 * the order lines, the pendings and last the buyer's message. Only refs, never ids. The result never passes `maxChars` on the real rendered
 * text: the oldest context messages go first, then what is left is filled by priority (current message and requests, order lines newest
 * first, pendings). The requests and the buyer's message are never cut.
 */
export function renderExtractionInput({ input, intents }: ExtractionInput, maxChars: number = defaultReadingBudgets.stageInputMaxChars): string {
  const head = [...photoLines(input), "Requests to extract:", ...intents.map(intentLine)];
  const tail = ["Buyer's message:", input.current.text === "" ? "(no text)" : input.current.text];
  const assemble = (context: readonly string[], items: readonly string[], pendings: readonly string[]) => [
    ...head,
    "Recent messages, oldest first:", ...(context.length ? context : ["No recent messages are listed."]),
    "Order lines:", ...(items.length ? items : ["No order lines are listed."]),
    "Pendings:", ...(pendings.length ? pendings : ["No pendings are listed."]),
    ...tail,
  ].join("\n");

  const items = input.items.map(itemLine);
  const pendings = pendingLines(input);
  let context = input.context.map(contextLine);
  while (context.length > 0 && assemble(context, items, pendings).length > maxChars) context = context.slice(1);
  if (assemble(context, items, pendings).length <= maxChars) return assemble(context, items, pendings);

  let remaining = maxChars - assemble([], [], []).length;
  const fit = (lines: readonly string[]) => lines.map((line) => { const fits = line.length + 1 <= remaining; if (fits) remaining -= line.length + 1; return fits; });
  const itemFits = fit([...items].reverse()).reverse();
  const pendingFits = fit(pendings);
  return assemble([], items.filter((_, index) => itemFits[index]), pendings.filter((_, index) => pendingFits[index]));
}
