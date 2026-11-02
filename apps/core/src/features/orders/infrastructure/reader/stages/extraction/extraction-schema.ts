import { z } from "zod";

/** At most this many entries in the strict schema; the application passes at most ten requests, and the parser needs exactly one entry for each. */
const maxListedRequests = 30;
const maxListedValues = 10;

const messageField = z.string().describe("current for the buyer's message, or the reference of a listed recent message, such as M3.");
const quote = (description: string) => z.strictObject({
  message: messageField,
  text: z.string().describe(description),
});
const words = quote("The shortest words of that message, copied exactly as written, that show it.");

const target = z.strictObject({
  kind: z.enum(["named", "item", "pending", "photo_same_message", "photo_just_sent", "context", "none"])
    .describe("What the request is about. named: the buyer names a product in words. item: an order line. pending: a pending. photo_same_message: the product of the photo this message captions. photo_just_sent: the photo the buyer sent just before. context: a product or line the buyer does not name, taken from the recent messages or the order. none: no product or line."),
  ref: z.string().nullable().describe("For item the reference of the order line (I1...), for pending the reference of the pending (Q1...). For context on last_photo or mentioned_product the reference of the recent message (M1...), and on only_item the order line. Null otherwise. Never invent a reference."),
  named: words.nullable().describe("The words the buyer uses for the product. Required for named. For item and pending the words the buyer used for it, or null when the buyer did not name it. Null otherwise."),
  basis: z.enum(["last_photo", "mentioned_product", "only_item"]).nullable().describe("Only for context. last_photo: the product of a photo in a recent message. mentioned_product: the product a recent message named. only_item: the one line of the order."),
});

const value = z.strictObject({
  attribute: words.nullable().describe("The words the buyer uses for the attribute («talla», «color»), or null when the buyer gives only the value."),
  value: words.describe("The words the buyer uses for the value, exactly as written. Do not turn them into a catalog value."),
});

const quantity = z.strictObject({
  value: z.number().describe("The number of units, as a number. A pair is 2 and a dozen is 12."),
  mode: z.enum(["add", "set", "decrease"]).describe("add: this many units, or this many more. set: the total the buyer wants to end with. decrease: this many fewer."),
  quote: words,
});

const price = z.strictObject({
  amount: z.number().describe("The amount the buyer states, copied as written. Never computed or divided."),
  currency: z.enum(["order", "other"]).describe("order: the buyer names no currency, or the shop's own. other: the buyer names a different currency."),
  basis: z.enum(["unit", "lot", "not_explicit"]).describe("unit: the amount is for each unit. lot: it is for the whole quantity. not_explicit: the buyer does not say."),
  quote: words,
});

const request = z.strictObject({
  request: z.string().describe("The reference of the request this entry answers (R1...)."),
  target,
  values: z.array(value).max(maxListedValues).describe("The attribute values the buyer gives for this request. Empty when there are none."),
  quantity: quantity.nullable().describe("The quantity the buyer states for this request, or null when none is stated."),
  price: price.nullable().describe("The price the buyer states for this request, or null when none is stated."),
  changeVerb: words.nullable().describe("For a change of an attribute, the verb the buyer uses to ask for the change. Null when the buyer uses none."),
});

/** The validated shape of the answer, the same for the primary and the confirming reading. */
export const extractionAnswerSchema = z.strictObject({
  requests: z.array(request).max(maxListedRequests).describe("One entry for each request listed in the input, with its reference."),
});
export type ExtractionAnswer = z.output<typeof extractionAnswerSchema>;
/** One entry of the answer: the parser checks entries one by one, so that a defective one leaves out its own request only. */
export const extractionEntrySchema = request;
export type ExtractionEntry = z.output<typeof request>;

/** The JSON schema sent as the strict output format. */
export const extractionJsonSchema: Record<string, unknown> = (() => {
  const schema: Record<string, unknown> = z.toJSONSchema(extractionAnswerSchema, { target: "draft-7" });
  delete schema.$schema;
  return schema;
})();
