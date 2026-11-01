import type { ReadingInput, ReadingItem, ReadingPending } from "@core/src/features/orders/domain/reader/readings";

/** The deterministic input bounds of the staged reader (technical design 6.8). Characters, never tokens. */
export type ReadingBudgets = Readonly<{
  /** Context messages: the most recent ones, within `contextHours` before the message. */
  contextMessages: number;
  contextHours: number;
  contextMessageChars: number;
  /** Order lines listed to the stages; an unlisted line is an `unclear_item`. */
  maxItems: number;
  /** Characters of one rendered stage input. */
  stageInputMaxChars: number;
}>;

export const defaultReadingBudgets: ReadingBudgets = { contextMessages: 12, contextHours: 48, contextMessageChars: 500, maxItems: 40, stageInputMaxChars: 24_000 };

/** A chat keeps at most this many pendings, so no more are ever listed. */
export const maxListedPendings = 10;

/** What the cut removed from a reading input; the reading never fails because of size. */
export type BudgetCut = Readonly<{ contextDropped: number; itemsOmitted: number; pendingsOmitted: number }>;

/** Cuts a context text to `maxChars` UTF-16 units, never leaving half of a surrogate pair. */
export function capContextText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

// Fixed characters each listed element costs for its label and separators; the stage renderers stay within them.
const elementOverhead = 32;
const idChars = 36;
// A rendered context line also carries its ref, direction, mask flag and «(no text)» around the kind and the text.
const contextOverhead = 48;
// The fixed section headers, empty-section notes and photo facts every stage input carries.
const frameChars = 360;

function itemChars(item: ReadingItem): number {
  const attributes = Object.entries(item.variantAttributes).reduce((sum, [name, value]) => sum + name.length + value.length + 4, 0);
  return item.productName.length + attributes + elementOverhead;
}

function pendingChars(pending: ReadingPending): number {
  const known = Object.entries(pending.known).reduce((sum, [name, value]) => sum + name.length + value.length + 4, 0);
  const names = (pending.productNames ?? []).reduce((sum, name) => sum + name.length + 2, 0);
  const missing = (pending.missing ?? []).reduce((sum, { name, values }) => sum + name.length + 12 + values.reduce((total, value) => total + value.length + 2, 0), 0);
  return known + pending.productIds.length * idChars + names + missing + elementOverhead;
}

function baseChars(input: ReadingInput): number {
  return frameChars + input.current.text.length + input.current.kind.length + elementOverhead + (input.photoMemory ? elementOverhead : 0) + (input.photo ? elementOverhead : 0);
}

/** The deterministic size of a reading input: the rendering accounts for each element with at most these characters. */
export function readingInputChars(input: ReadingInput): number {
  return baseChars(input)
    + input.context.reduce((sum, message) => sum + (message.text?.length ?? 0) + message.kind.length + contextOverhead, 0)
    + input.items.reduce((sum, item) => sum + itemChars(item), 0)
    + input.pendings.reduce((sum, pending) => sum + pendingChars(pending), 0);
}

/**
 * Brings a reading input under `maxChars`, in the fixed cut order: the oldest context messages first (cut 1), then, filling in priority
 * current message, order lines newest first, pendings (cut 4), what does not fit is omitted. Cuts 2 and 3 belong to candidate rendering.
 */
export function fitReadingInput(input: ReadingInput, maxChars: number): Readonly<{ input: ReadingInput; cut: BudgetCut }> {
  if (readingInputChars(input) <= maxChars) return { input, cut: { contextDropped: 0, itemsOmitted: 0, pendingsOmitted: 0 } };
  let context = input.context;
  while (context.length > 0 && readingInputChars({ ...input, context }) > maxChars) context = context.slice(1);
  const contextDropped = input.context.length - context.length;
  const withContext = { ...input, context };
  if (readingInputChars(withContext) <= maxChars) return { input: withContext, cut: { contextDropped, itemsOmitted: 0, pendingsOmitted: 0 } };
  let remaining = maxChars - baseChars(input);
  const keptItems = new Set<ReadingItem>();
  for (const item of [...input.items].reverse()) {
    const size = itemChars(item);
    if (size <= remaining) { keptItems.add(item); remaining -= size; }
  }
  const keptPendings = new Set<ReadingPending>();
  for (const pending of input.pendings) {
    const size = pendingChars(pending);
    if (size <= remaining) { keptPendings.add(pending); remaining -= size; }
  }
  const fitted = { ...input, context: [], items: input.items.filter((item) => keptItems.has(item)), pendings: input.pendings.filter((pending) => keptPendings.has(pending)) };
  return { input: fitted, cut: { contextDropped: input.context.length, itemsOmitted: input.items.length - fitted.items.length, pendingsOmitted: input.pendings.length - fitted.pendings.length } };
}
