import { z } from "zod";
import { currencies } from "@shared/money";
import type { AttributeChoice, ReaderAction, ReaderAnswer, ReaderItem, ReaderProduct, StatedPrice } from "@core/src/features/orders/domain/chat-reading";

/** The strict schema carries at most this many actions; `moreActions` says the message asked for more. */
const maxReaderActions = 10;
/** Zod accepts more than the JSON schema asks for, in case strict mode does not enforce `maxItems`; code treats the extra ones as «too many». */
const maxParsedActions = 30;

const ref = "A reference given in the context, such as P1, I2 or Q1. Never invent one.";
const productSchema = z.strictObject({
  kind: z.enum(["ref", "one_of", "not_in_catalog", "unnamed"]).describe("ref: one listed product. one_of: two or more listed products the buyer may mean. not_in_catalog: a product the buyer names that is not listed. unnamed: no product is named."),
  ref: z.string().nullable().describe(`Only for kind ref. ${ref}`),
  refs: z.array(z.string()).nullable().describe("Only for kind one_of: at least two product references."),
});
const itemSchema = z.strictObject({
  kind: z.enum(["ref", "unnamed", "not_in_order"]).describe("ref: one listed order item. unnamed: the buyer does not say which item (new attribute values with no item named are variant_only). not_in_order: the item is not in the order."),
  ref: z.string().nullable().describe(`Only for kind ref. ${ref}`),
});
const attributeSchema = z.strictObject({
  name: z.string().describe("The attribute name exactly as the catalog lists it."),
  value: z.string().describe("The attribute value exactly as the catalog lists it."),
});
const priceSchema = z.strictObject({
  amount: z.string().describe("The price the buyer states, as written, digits only."),
  currency: z.enum(["not_named", ...currencies, "other"]).describe("soles or S/ is PEN, dólares or US$ is USD; other for an unlisted currency; not_named when none is named."),
  per: z.enum(["unit", "lot", "not_explicit"]).describe("unit: each. lot: for the whole quantity. not_explicit: the buyer does not say."),
});
const attributes = z.array(attributeSchema).nullable().describe("The attribute values the buyer chose, or null.");
const quantity = z.number().nullable().describe("The quantity, or null when the buyer states none.");
const stated = priceSchema.nullable().describe("The price the buyer states, or null.");

const actionKinds = ["add", "complete_pending", "decline_pending", "decline_shown", "remove", "change_quantity", "change_variant", "set_price",
  "ready", "variant_only", "variant_for_pendings", "not_allowed"] as const;

const actionSchema = z.strictObject({
  kind: z.enum(actionKinds),
  product: productSchema.nullable().describe("Only for add."),
  pendingProduct: z.string().nullable().describe("Only for complete_pending: the product reference the buyer now names, or null when the pending's own product is meant."),
  attributes,
  quantity,
  price: stated,
  pending: z.string().nullable().describe("For complete_pending and decline_pending: the pending reference."),
  item: itemSchema.nullable().describe("For remove, change_quantity, change_variant and set_price."),
  amount: z.enum(["all", "one"]).nullable().describe("Only for remove."),
  mode: z.enum(["increase", "set"]).nullable().describe("Only for change_quantity."),
  pendings: z.array(z.string()).nullable().describe("Only for variant_for_pendings: at least two pending references."),
});

const answerShape = (maxActions: number) => z.strictObject({
  outcome: z.enum(["actions", "no_intent", "doubt"]).describe("actions: the message asks for one or more actions. no_intent: the message asks for nothing. doubt: the message may ask for something but you cannot tell what."),
  actions: z.array(actionSchema).max(maxActions).describe("Empty unless outcome is actions."),
  moreActions: z.boolean().describe("True when the message asks for more actions than the ones listed."),
});

type ParsedAction = z.output<typeof actionSchema>;

const choices = (list: ParsedAction["attributes"]): readonly AttributeChoice[] => (list ?? []).map(({ name, value }) => ({ name, value }));
const priceOf = (price: ParsedAction["price"]): StatedPrice | null => (price ? { amount: price.amount, currency: price.currency, per: price.per } : null);
const atLeastTwo = (refs: readonly string[] | null): refs is readonly [string, string, ...string[]] => refs !== null && refs.length >= 2 && refs.every((value) => value.length > 0);

function productOf({ product }: ParsedAction): ReaderProduct | null {
  if (!product) return null;
  if (product.kind === "ref") return product.ref ? { kind: "ref", ref: product.ref } : null;
  if (product.kind === "one_of") return atLeastTwo(product.refs) ? { kind: "one_of", refs: product.refs } : null;
  return { kind: product.kind };
}
function itemOf({ item }: ParsedAction): ReaderItem | null {
  if (!item) return null;
  if (item.kind === "ref") return item.ref ? { kind: "ref", ref: item.ref } : null;
  return { kind: item.kind };
}

/** The action of one parsed entry. Strict mode makes every field required, so each kind checks the ones it uses; an incomplete or inconsistent one is `malformed` and fails only itself. */
function convertAction(action: ParsedAction): ReaderAction {
  const malformed: ReaderAction = { kind: "malformed" };
  switch (action.kind) {
    case "add": {
      const product = productOf(action);
      return product ? { kind: "add", product, attributes: choices(action.attributes), quantity: action.quantity, price: priceOf(action.price) } : malformed;
    }
    case "complete_pending":
      return action.pending ? { kind: "complete_pending", pending: action.pending, product: action.pendingProduct, attributes: choices(action.attributes), quantity: action.quantity, price: priceOf(action.price) } : malformed;
    case "decline_pending": return action.pending ? { kind: "decline_pending", pending: action.pending } : malformed;
    case "remove": {
      const item = itemOf(action);
      return item && action.amount ? { kind: "remove", item, amount: action.amount } : malformed;
    }
    case "change_quantity": {
      const item = itemOf(action);
      return item && action.mode && action.quantity !== null ? { kind: "change_quantity", item, mode: action.mode, quantity: action.quantity } : malformed;
    }
    case "change_variant": {
      const item = itemOf(action);
      return item ? { kind: "change_variant", item, attributes: choices(action.attributes), price: priceOf(action.price) } : malformed;
    }
    case "set_price": {
      const item = itemOf(action);
      const price = priceOf(action.price);
      return item && price ? { kind: "set_price", item, price } : malformed;
    }
    case "variant_for_pendings": return atLeastTwo(action.pendings) ? { kind: "variant_for_pendings", pendings: action.pendings } : malformed;
    case "decline_shown":
    case "ready":
    case "variant_only":
    case "not_allowed": return { kind: action.kind };
  }
}

/** The one answer schema, the same for every message; nothing in it comes from a context. Only an `actions` outcome without actions fails here: a malformed action fails itself in `toReaderAnswer`. */
export const readerSchema = answerShape(maxParsedActions).superRefine((parsed, context) => {
  if (parsed.outcome === "actions" && parsed.actions.length === 0) context.addIssue({ code: "custom", message: "actions: empty", path: ["actions"] });
});

/** The JSON schema sent as the strict `text.format`: at most `maxReaderActions` actions, no `$schema`. */
export const readerJsonSchema: Record<string, unknown> = (() => {
  const schema: Record<string, unknown> = z.toJSONSchema(answerShape(maxReaderActions), { target: "draft-7" });
  delete schema.$schema;
  return schema;
})();

type ReaderOutput = z.output<typeof readerSchema>;

/** The domain answer of a parsed output. Call it only with a value `readerSchema` accepted. */
export function toReaderAnswer(parsed: ReaderOutput): ReaderAnswer {
  if (parsed.outcome !== "actions") return { kind: parsed.outcome };
  const [first, ...rest] = parsed.actions.map(convertAction);
  if (!first) throw new Error("The output was not accepted by readerSchema");
  return { kind: "actions", actions: [first, ...rest], moreActions: parsed.moreActions };
}
