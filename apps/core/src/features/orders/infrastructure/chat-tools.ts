import { z } from "zod";
import { currencies } from "@shared/money";
import { defineTool, defineToolRegistry, type DecisionChoiceQuestion, type ToolDefinition } from "@core/src/shared/ai-tools/application/tool-registry";
import type { ResolvedChatAction } from "@core/src/features/orders/domain/chat-order";
import type { ChatContextItem, ChatToolContext, ToolResolveError } from "@core/src/features/orders/application/chat-tool-types";
import type { ChatTool, ChatToolActions, ChatToolName, ChatToolRegistry } from "@core/src/features/orders/application/chat-message-actions";
import {
  asksItemReference, CHANGE_REQUEST_VALUES, itemChoiceValues, itemQuestionValues, MAX_ADD_LINES, type AddProductLine, type ItemReference, type StatedPrice,
} from "@core/src/features/orders/application/chat-text-actions";

// The tools the models see for chat messages: names, descriptions, Decision questions and the strict schemas that validate their JSON.
// Each tool maps its validated arguments to the typed input of a chat action, where every business rule lives.

const chatTool = <Args>(definition: ToolDefinition<ChatToolContext, Args, ResolvedChatAction, ToolResolveError> & Readonly<{ name: ChatToolName }>): ChatTool =>
  defineTool<ChatToolContext, Args, ResolvedChatAction, ToolResolveError>(definition);

export const mentionedPriceArgs = z.object({
  amount: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/).describe("The amount in digits, with a dot for cents: «45», «9.90»."),
  units: z.number().int().min(1).describe("How many units the amount pays for: 1 for a price per unit («a 45 soles», «45 c/u», «a 45 cada una»); "
    + "the units it covers for a price of several («las 4 por 120» is 4)."),
  // The models name the currency they read; whether it is the order's is decided against the item's catalog price, which they do not know.
  currency: z.enum(["not_named", ...currencies, "other"]).describe("The currency the buyer names, as its code (soles PEN, dólares USD, reais BRL); "
    + "not_named when the buyer names none; other for any other currency."),
}).describe("Only a price the buyer writes in this message, never a unit price of the open order.") satisfies z.ZodType<StatedPrice>;

const noArgs = z.object({});

// Item references: a Decision choice over the order's labels, gated by its confidence in the chat actions.
const choiceOf = <Value extends z.ZodType>(value: Value) => z.object({ value, confidence: z.number().min(0).max(1) });
const itemChoice = (context: ChatToolContext) => choiceOf(z.enum(itemChoiceValues(context) as [string, ...string[]]));
const amountChoice = choiceOf(z.enum(["all", "one"]));
// Asked only with a single item, whose choice no longer says whether the message named it; it only sets `namedItem`, so it is not gated.
const referenceChoice = choiceOf(z.enum(["named", "unnamed"]));
const changeRequestChoice = choiceOf(z.enum(CHANGE_REQUEST_VALUES));

/** The item tool's argument schema, plus the reference answer when the order has a single item. */
function withReference<Shape extends z.ZodRawShape>(context: ChatToolContext, shape: Shape) {
  const full = z.object({ ...shape, reference: referenceChoice.optional() });
  return asksItemReference(context) ? full : z.object(shape) as unknown as typeof full;
}

/** The item reference of validated item tool arguments, as the chat actions take it. */
const itemReferenceOf = (args: ItemReference): ItemReference => (args.reference ? { item: args.item, reference: args.reference } : { item: args.item });

const variantLabel = (item: ChatContextItem) => `${item.productName}${Object.values(item.variantAttributes).map((value) => ` ${value}`).join("")}`;

const sentinelDescriptions: Readonly<Record<string, string>> = {
  unnamed: "The message refers to an item without saying which (eso, elimínalo, déjalo en dos)",
  not_in_order: "The message names a product the open order does not contain",
  ambiguous: "More than one item of the order fits what the message names",
};

/**
 * Each item tool asks its own question, so a message about two items («súmame una mochila y saca el short») is read per action. The
 * chat actions decide which values it offers (itemQuestionValues); with a single item, that item is described as also meant without a name.
 */
function itemQuestion(context: ChatToolContext, instructions: string): DecisionChoiceQuestion {
  const single = asksItemReference(context);
  const describe = (value: string) => {
    const item = context.items.find(({ label }) => label === value);
    if (!item) return sentinelDescriptions[value]!;
    return single ? `${variantLabel(item)}, the only item of the open order, also when the message does not name it (eso, elimínalo, déjalo en cuatro)` : variantLabel(item);
  };
  return { name: "item", instructions, choices: itemQuestionValues(context).map((value) => ({ value, description: describe(value) })) };
}

const referenceQuestion: DecisionChoiceQuestion = {
  name: "reference",
  instructions: "Does the message name the item it refers to?",
  choices: [
    { value: "named", description: "It names the item by its product, size or color" },
    { value: "unnamed", description: "It refers to the item without naming it (eso, elimínalo, déjalo en cuatro)" },
  ],
};

/** The item question of an item tool and, with a single item, whether the message named it. */
const itemQuestions = (context: ChatToolContext, instructions: string): readonly DecisionChoiceQuestion[] =>
  [itemQuestion(context, instructions), ...(asksItemReference(context) ? [referenceQuestion] : [])];

const amountQuestion: DecisionChoiceQuestion = {
  name: "amount",
  instructions: "Does the buyer remove the whole item or only one unit of it?",
  choices: [
    { value: "all", description: "Remove the item, whatever its quantity (saca la mochila, elimínalo, ya no va)" },
    { value: "one", description: "Remove a single unit and keep the rest (réstale uno, deja dos de las tres casacas)" },
  ],
};

const changeRequestQuestion: DecisionChoiceQuestion = {
  name: "change",
  instructions: "Does the buyer explicitly ask to change the item to another variant, or only name a variant?",
  choices: [
    { value: "requested", description: "The buyer explicitly asks to change the item: a verb of change, or «mejor» putting the new variant in place of the item's current one" },
    { value: "only_named", description: "The buyer only gives a size or color, or says they want, need or prefer it («la prefiero en XS»), without asking to change the item" },
  ],
};

const addLine = z.object({
  productMention: z.string().max(120).describe("The product words only, without size, color, quantity or price: «chaleco acolchado celeste XS x3» is «chaleco acolchado»."),
  variantWords: z.array(z.string().max(60)).max(5).describe("The size and color words as written, with any «talla» or «color» before them, never product words: «short deportivo celeste talla 38» gives «celeste», «talla 38»."),
  quantity: z.number().int().min(1).nullable().describe("The units the buyer asks for, in digits, number words or quantity idioms (a pair is 2, half a dozen 6, a dozen 12, «x3» 3). "
    + "Only the units of this line: «3 mochilas, dos celestes y una gris» is two lines, of 2 and 1. Null when not stated."),
  mentionedPrice: mentionedPriceArgs.nullable(),
}) satisfies z.ZodType<AddProductLine>;
const addProductsArgs = z.object({ lines: z.array(addLine).min(1).max(MAX_ADD_LINES) });

const detailsArgs = z.object({
  variantWords: z.array(z.string().max(60)).max(5),
  quantity: z.number().int().min(1).nullable(),
  perEach: z.boolean(),
  mentionedPrice: mentionedPriceArgs.nullable(),
});

/** The tool registry of chat messages: the photo tools, `no_intent` and the text tools, in the order a message reads in. */
export function createChatToolRegistry(actions: ChatToolActions): ChatToolRegistry {
  return defineToolRegistry<ChatToolContext, ResolvedChatAction, ToolResolveError>([
    chatTool({
      name: "add_shown_product",
      description: "The buyer wants the product in the photo, and the caption gives no size, color, quantity or price for it.",
      args: { kind: "none" }, schema: () => noArgs,
      resolve: (_args, context, signal) => actions.addShownProduct(context, signal),
    }),
    chatTool({
      name: "add_shown_product_with_details",
      description: "The caption gives a size, color, quantity (including «tres de cada uno») or price for the product in the photo, even in one or two words "
        + "(«en XS», «talla XS», «XS celeste», «3»). "
        + "Give the variant words as written, the quantity only if stated, perEach true when the quantity is for each product of the photo, and the price as stated.",
      args: { kind: "extracted" }, schema: () => detailsArgs,
      resolve: (args, context, signal) => actions.addShownProductWithDetails(
        { variantWords: args.variantWords, quantity: args.quantity, perEach: args.perEach, mentionedPrice: args.mentionedPrice }, context, signal),
    }),
    chatTool({
      name: "decline_shown_product",
      description: "The caption says the buyer does not want the product in the photo.",
      args: { kind: "none" }, schema: () => noArgs,
      resolve: () => actions.declineShownProduct(),
    }),
    chatTool({
      name: "report_request_with_non_product_image",
      description: "The image is not a product and the caption asks to add, remove or change something in the order, "
        + "even when it names the product to add («y súmale una mochila»).",
      args: { kind: "none" }, reportOnly: true, schema: () => noArgs,
      resolve: () => actions.reportRequestWithNonProductImage(),
    }),
    chatTool({
      name: "no_intent",
      description: "The message asks for nothing to be added, removed or changed: greetings, questions about prices, availability or delivery, addresses, thanks, "
        + "payment reports. Never a message that names a product to buy, even without a verb («chaleco acolchado celeste XS x3», a list of products), "
        + "or that only gives a size, color or quantity, even in one word («celeste», «en XS», «talla XS»). "
        + "A question followed by a request («¿todavía tienes la mochila? resérvamela entonces») asks for the product.",
      args: { kind: "none" }, schema: () => noArgs,
      resolve: () => actions.noIntent(),
    }),
    chatTool({
      name: "add_products",
      description: "The buyer asks to add one or several products they name to the order, in one line or several («súmame una mochila celeste», «quiero 3 casacas talla XS», «me guardas el vestido»). "
        + "A message that only names a product the open order does not have, with its size, color, quantity («x3») or price («vestido floreado talla XS», «la casaca de 120 en L») also asks for it. "
        + "Give each product as the buyer wrote it (without quantity or variant), its variant words as written, the quantity only if stated, and the price only if stated.",
      args: { kind: "extracted" }, schema: () => addProductsArgs,
      resolve: (args, context, signal) => actions.addProducts({ lines: args.lines }, context, signal),
    }),
    chatTool({
      name: "remove_item",
      description: "The buyer asks to take an item out of the open order, or one unit of it: «saca la mochila», «elimínalo», «ya no quiero la casaca», «réstale uno».",
      args: { kind: "decision", questions: (context) => [...itemQuestions(context, "Which item of the open order does the buyer ask to remove?"), amountQuestion] },
      schema: (context) => withReference(context, { item: itemChoice(context), amount: amountChoice }),
      resolve: (args, context, signal) => actions.removeItem({ ...itemReferenceOf(args), amount: args.amount }, context, signal),
    }),
    chatTool({
      name: "change_item_quantity",
      description: "The buyer changes how many units they want of a product already in the open order: «déjalo en cuatro», «de la casaca solo una». "
        + "Not for asking for products with a quantity («quiero 3 mochilas» adds them), not for taking an item out («saca el short» removes it), "
        + "and never for asking for more of something the buyer does not name («agrégame otros tres», «el mismo otra vez»). Give the new quantity as stated.",
      args: { kind: "extracted", questions: (context) => itemQuestions(context, "Which item of the open order does the buyer change the quantity of?") },
      schema: (context) => withReference(context, { item: itemChoice(context), quantity: z.number().int().min(0) }),
      resolve: (args, context, signal) => actions.changeItemQuantity({ ...itemReferenceOf(args), quantity: args.quantity }, context, signal),
    }),
    chatTool({
      name: "change_item_variant",
      description: "The text gives a size or color for an item already in the open order (a product the order does not have is an add, not this item): it asks to change the item to that variant "
        + "(«pásalo a talla 40», «mejor la casaca en celeste»), or only names the variant, even in one word («en XS», «la prefiero en XS», «celeste»). "
        + "Give the variant words as written and the price only if stated.",
      args: { kind: "extracted", questions: (context) => [...itemQuestions(context, "Which item of the open order does the variant refer to?"), changeRequestQuestion] },
      schema: (context) => withReference(context, { item: itemChoice(context), change: changeRequestChoice,
        variantWords: z.array(z.string().max(60)).min(1).max(5).describe("The size and color words as written, with any «talla» or «color» before them, never product words: «mejor la casaquita celeste» gives «celeste»."),
        mentionedPrice: mentionedPriceArgs.nullable() }),
      // The interpreter sends a call without an explicit change request to report_variant_without_product (variantOnlyRule).
      resolve: (args, context, signal) => actions.changeItemVariant(
        { ...itemReferenceOf(args), change: args.change, variantWords: args.variantWords, mentionedPrice: args.mentionedPrice }, context, signal),
    }),
    chatTool({
      name: "set_item_mentioned_price",
      description: "The buyer states a price for a product already in the open order, without asking for a new product: «la casaca a 110», «el short en 40 nomás». "
        + "A price written next to a product the buyer asks for is part of adding it. Give the price as stated.",
      args: { kind: "extracted", questions: (context) => itemQuestions(context, "Which item of the open order does the stated price refer to?") },
      schema: (context) => withReference(context, { item: itemChoice(context), mentionedPrice: mentionedPriceArgs }),
      resolve: (args, context, signal) => actions.setItemMentionedPrice({ ...itemReferenceOf(args), mentionedPrice: args.mentionedPrice }, context, signal),
    }),
    chatTool({
      name: "mark_order_ready",
      description: "The buyer says the order is complete or confirms it (con eso cierro, con eso termino, confírmalo, así queda). "
        + "After another request in the same message («saca el short y con eso cierro», «súmame la mochila y con eso termino») it is a second action: the message asks for several.",
      args: { kind: "none" }, schema: () => noArgs,
      resolve: () => actions.markOrderReady(),
    }),
    chatTool({
      name: "report_variant_without_product",
      description: "The text gives only a size or color, even in a single word, with no product name and no verb that changes an item (pásalo, déjalo en): «en XS», «la prefiero en XS», «celeste», «talla 38». "
        + "Asking for it («la prefiero») with only a size or color is this report, never a change or an add.",
      args: { kind: "none" }, reportOnly: true, schema: () => noArgs, resolve: () => actions.reportVariantWithoutProduct(),
    }),
    chatTool({
      name: "report_unnamed_add",
      description: "The buyer asks for more of something without naming it (quiero más, el mismo otra vez, agrégame otros tres).",
      args: { kind: "none" }, reportOnly: true, schema: () => noArgs, resolve: () => actions.reportUnnamedAdd(),
    }),
    chatTool({
      name: "report_item_change_without_order",
      description: "The buyer asks to remove or change something of their order (elimínalo, saca el short, déjalo en cuatro, pásalo a talla 40, la casaca a 90), "
        + "but the chat has no open order. Never for asking for products.",
      args: { kind: "none" }, reportOnly: true, schema: () => noArgs, resolve: () => actions.reportItemChangeWithoutOrder(),
    }),
  ]);
}
