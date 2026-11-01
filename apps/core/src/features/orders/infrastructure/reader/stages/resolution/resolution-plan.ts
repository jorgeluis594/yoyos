import type { MentionPrice, ProductMention } from "@core/src/features/orders/domain/reader/readings";
import type { RequestRef } from "@core/src/features/orders/domain/reader/refs";
import type { ProductForReading } from "@core/src/features/products/domain/reading-product";
import type { ProductId } from "@core/src/features/products/domain/product";
import type { ResolutionInput } from "@core/src/features/orders/infrastructure/reader/runtime/stage-version";

/** Values listed per attribute before «y N más» (technical design 6.8). */
export const maxValuesPerAttribute = 30;

export type ResolutionCut = Readonly<{ candidatesPerMention: number | null; droppedValues: boolean; omittedMentions: number; omittedProducts: number }>;
export type ResolutionPlan = Readonly<{
  /** The rendered input, never longer than the budget. */
  text: string;
  /** «P1» → product, for the products that were rendered. */
  products: ReadonlyMap<string, ProductForReading>;
  /** The mentions that were rendered, with the product ids each may be resolved to. */
  rendered: readonly Readonly<{ mention: ProductMention; allowed: readonly ProductId[] }>[];
  /** Mentions that were not rendered (no candidate, or nothing fit): their resolution is `none`. */
  omitted: readonly ProductMention[];
  cut: ResolutionCut;
}>;

const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Attributes of a product whose values the mention's words may map to: all of them when a value has no attribute words or they match none. */
function namedAttributes(product: ProductForReading, mention: ProductMention): ReadonlySet<string> {
  const named = new Set<string>();
  const all = product.attributes.map(({ name }) => name);
  for (const value of mention.values) {
    const words = value.attributeWords ? fold(value.attributeWords.text) : "";
    const hits = words ? all.filter((name) => fold(name).includes(words) || words.includes(fold(name))) : [];
    for (const name of hits.length ? hits : all) named.add(name);
  }
  return named;
}

type Entry = Readonly<{ mention: ProductMention; ids: readonly ProductId[] }>;

function renderAttribute(name: string, values: readonly string[], full: boolean): string {
  if (!full) return `${name}: ${values.length} values`;
  const shown = values.slice(0, maxValuesPerAttribute).join(", ");
  return `${name} = ${shown}${values.length > maxValuesPerAttribute ? `, y ${values.length - maxValuesPerAttribute} más` : ""}`;
}

function priceText({ amount, units, basis }: MentionPrice): string {
  if (basis === "unit" || units === 1) return `${amount} for each unit`;
  return `${amount} for ${units} units${basis === "lot" ? ", the whole quantity" : ", each or the whole quantity (not said)"}`;
}

/** The lowest and highest unit price of a product's active variants, in its currency; null when it has no variant. */
function priceRange(product: ProductForReading): string | null {
  const amounts = product.variants.map(({ unitPrice }) => unitPrice.amount);
  if (!amounts.length) return null;
  const [low, high] = [Math.min(...amounts), Math.max(...amounts)];
  return `${low === high ? low : `${low} to ${high}`} ${product.variants[0]!.unitPrice.currency}`;
}

function compose(entries: readonly Entry[], byId: ReadonlyMap<ProductId, ProductForReading>, withCandidateLines: boolean, valuesFor: (id: ProductId) => boolean) {
  const order = [...new Set(entries.flatMap(({ ids }) => ids))];
  const refs = new Map(order.map((id, index) => [id, `P${index + 1}`]));
  const lines = ["Mentions:", ...entries.flatMap(({ mention, ids }) => {
    const values = mention.values.map((value) => `${value.attributeWords ? `${value.attributeWords.text} ` : ""}«${value.valueWords.text}»`);
    const subject = mention.valuesOnly ? "(product already known)" : `«${mention.words.text}»`;
    return [`${mention.request}: ${subject}${values.length ? ` — values: ${values.join("; ")}` : ""}${mention.price ? ` — stated price: ${priceText(mention.price)}` : ""}`,
      ...withCandidateLines ? [`${mention.request} may be: ${ids.map((id) => refs.get(id)).join(", ")}`] : []];
  }), "Products (answer with these labels):", ...order.map((id) => {
    const product = byId.get(id)!;
    const named = new Set(entries.filter(({ ids }) => ids.includes(id)).flatMap(({ mention }) => [...namedAttributes(product, mention)]));
    const attributes = product.attributes.map(({ name, values }) => renderAttribute(name, values, valuesFor(id) && named.has(name)));
    const range = entries.some(({ ids, mention }) => mention.price && ids.includes(id)) ? priceRange(product) : null;
    return `${refs.get(id)} (${product.sellable ? "sellable" : "not sellable"}) ${product.name}${attributes.length ? ` — ${attributes.join("; ")}` : ""}${range ? ` — price: ${range}` : ""}`;
  })];
  return { text: lines.join("\n"), refs, order };
}

/**
 * The deterministic rendering of a resolution input and what the parser needs to read the answer. The cut order of design 6.8 applies to
 * the real rendered text: candidates per mention to 1, then attribute values only for the mentions' first candidates (with per-mention candidate lists, cut 1 already leaves one candidate each,
 * so this step renders what cut 1 renders and only matters when every mention sees every product), then a fixed priority
 * fill (mentions in order, then candidates by search rank) that omits what does not fit. An omitted mention resolves to `none`.
 */
export function planResolution(input: ResolutionInput, maxChars: number): ResolutionPlan {
  const byId = new Map(input.candidates.map((product) => [product.productId, product]));
  const everyId = input.candidates.map(({ productId }) => productId);
  const withLines = input.mentions.some(({ candidateIds }) => candidateIds !== undefined);
  const entries: Entry[] = input.mentions.map((mention) => ({ mention, ids: (mention.candidateIds ?? everyId).filter((id) => byId.has(id)) }));
  const searchable = entries.filter(({ ids }) => ids.length > 0);
  const noCandidates = entries.filter(({ ids }) => !ids.length).map(({ mention }) => mention);
  const finish = (used: readonly Entry[], valuesFor: (id: ProductId) => boolean, cut: Partial<ResolutionCut>): ResolutionPlan | null => {
    const { text, refs, order } = compose(used, byId, withLines, valuesFor);
    if (text.length > maxChars) return null;
    const usedMentions = new Set(used.map(({ mention }) => mention));
    return { text, products: new Map(order.map((id) => [refs.get(id)!, byId.get(id)!])), rendered: used.map(({ mention, ids }) => ({ mention, allowed: ids })),
      omitted: input.mentions.filter((mention) => !usedMentions.has(mention)),
      cut: { candidatesPerMention: null, droppedValues: false, omittedMentions: noCandidates.length + (searchable.length - used.length), omittedProducts: 0, ...cut } };
  };
  const all = () => true;
  const full = finish(searchable, all, {});
  if (full) return full;
  const single = searchable.map((entry) => withLines ? { ...entry, ids: entry.ids.slice(0, 1) } : entry);
  const one = withLines ? finish(single, all, { candidatesPerMention: 1 }) : null;
  if (one) return one;
  const bestOfAny = new Set(single.map(({ ids }) => ids[0]!));
  const trimmed = finish(single, (id) => bestOfAny.has(id), { candidatesPerMention: withLines ? 1 : null, droppedValues: true });
  if (trimmed) return trimmed;
  // Fixed priority fill: mentions in order, then candidates by search rank, keeping only what fits.
  const chosen: { mention: ProductMention; ids: ProductId[]; pool: readonly ProductId[] }[] = [];
  const fits = (state: readonly Entry[]) => compose(state, byId, withLines, (id) => bestOfAny.has(id)).text.length <= maxChars;
  for (const { mention, ids } of searchable) {
    chosen.push({ mention, ids: [], pool: ids });
    if (!fits(chosen)) chosen.pop();
  }
  const maxRank = Math.max(0, ...chosen.map(({ pool }) => pool.length));
  for (let rank = 0; rank < maxRank; rank += 1) for (const entry of chosen) {
    const id = entry.pool[rank];
    if (id === undefined) continue;
    entry.ids.push(id);
    if (!fits(chosen)) entry.ids.pop();
  }
  const used = chosen.filter(({ ids }) => ids.length > 0);
  const droppedProducts = searchable.reduce((sum, { ids }) => sum + ids.length, 0) - used.reduce((sum, { ids }) => sum + ids.length, 0);
  const plan = finish(used, (id) => bestOfAny.has(id), { candidatesPerMention: withLines ? 1 : null, droppedValues: true, omittedProducts: droppedProducts });
  return plan ?? { text: "Mentions:\nProducts (answer with these labels):", products: new Map(), rendered: [], omitted: input.mentions, cut: { candidatesPerMention: null, droppedValues: true, omittedMentions: input.mentions.length, omittedProducts: droppedProducts } };
}

export const noneFor = (request: RequestRef) => ({ request, kind: "none" as const });
