import { expect, test } from "vitest";
import { err, ok } from "@shared/functional";
import { orchestrate, type DecisionRequest, type OrchestrateDependencies } from "@core/src/shared/ai-tools/application/orchestrate";
import { decisionRequestText } from "@core/src/shared/ai-tools/infrastructure/decision-request-text";
import { createChatToolRegistry, toolsFor } from "@core/src/features/orders/application/chat-message-tools";
import { describeChatContext } from "@core/src/features/orders/infrastructure/chat-context-text";
import type { ChatContextItem, ChatToolContext, ChatToolDependencies } from "@core/src/features/orders/application/chat-tool-types";
import type { CatalogItem } from "@core/src/features/products/domain/image-identification";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const variant = (n: number, variantAttributes: Record<string, string>): CatalogItem =>
  ({ variantId: id(n) as VariantId, productName: "Casaca", variantAttributes, sku: null, unitPrice: { amount: 120, currency: "PEN" } });
const contextItem = (label: string, n: number, productName: string, variantAttributes: Record<string, string>, quantity: number): ChatContextItem =>
  ({ label, variantId: id(n) as VariantId, productId: id(n + 50) as ProductId, productName, variantAttributes, quantity, unitPrice: { amount: 45.5, currency: "PEN" } });

const unused = async () => { throw new Error("A tool is not resolved here"); };
const deps: ChatToolDependencies = { loadSellableVariants: unused, resolveVariant: unused, identifyProductsInText: unused, findTopTextCandidate: unused };
const registry = createChatToolRegistry(deps);

const shown = [
  { product: { productId: id(20) as ProductId, name: "Casaca", variants: [variant(21, { Talla: "S", Color: "Celeste" }), variant(22, { Talla: "M", Color: "Gris" })] },
    preselectedVariantId: null, identification: { method: "visual" as const, productId: id(20) as ProductId, confidence: 0.9 } },
  { product: { productId: id(30) as ProductId, name: "Gorra", variants: [variant(31, {})] }, preselectedVariantId: id(31) as VariantId,
    identification: { method: "qr" as const, productId: id(30) as ProductId, confidence: null } },
];
const oneItem = [contextItem("I1", 1, "Mochila", { Color: "Celeste" }, 2)];
const twoItems = [...oneItem, contextItem("I2", 2, "Short", {}, 1)];

/** Every kind of message and order the tools are offered for. */
const contexts: Readonly<Record<string, ChatToolContext>> = {
  photo_product_without_order: { kind: "photo_product", caption: "x", items: [], shown },
  photo_product_with_order: { kind: "photo_product", caption: "x", items: twoItems, shown: shown.slice(0, 1) },
  photo_not_product: { kind: "photo_not_product", caption: "x", items: [], shown: [] },
  text_without_order: { kind: "text", caption: "x", items: [], shown: [] },
  text_with_one_item: { kind: "text", caption: "x", items: oneItem, shown: [] },
  text_with_two_items: { kind: "text", caption: "x", items: twoItems, shown: [] },
};

/** The Decision request the orchestrator sends for a context; the fake stops it there. */
async function decisionRequestOf(context: ChatToolContext): Promise<DecisionRequest> {
  let request: DecisionRequest | null = null;
  const ai: OrchestrateDependencies = {
    text: decisionRequestText,
    decide: async (sent) => { request = sent; return err({ code: "AI_PROVIDER_UNAVAILABLE", message: "stop" }); },
    extract: async () => ok([]), minActionConfidence: 0.6, minToolPredicate: 0.5, minReportPredicate: 0.9,
  };
  await orchestrate({ messageParts: [], contextText: describeChatContext(context), context, tools: toolsFor(registry, context) }, ai, new AbortController().signal);
  if (!request) throw new Error("No Decision request");
  return request;
}

/** All the text the models get for each context, besides the buyer's message and the provider clients' fixed instructions. */
async function modelText() {
  const entries = await Promise.all(Object.entries(contexts).map(async ([name, context]) => [name, {
    tools: toolsFor(registry, context).map((tool) => ({
      name: tool.name, description: tool.description, args: tool.args.kind, reportOnly: tool.reportOnly,
      questions: tool.args.kind === "none" ? [] : tool.args.questions?.(context) ?? [],
      jsonSchema: tool.jsonSchema(context),
    })),
    decisionRequest: await decisionRequestOf(context),
  }] as const));
  return Object.fromEntries(entries);
}

test("every tool name, description, schema, question and context text the models get stays byte-identical", async () => {
  // Generated from the code before the tool definitions moved to infrastructure; any change of model-facing text fails here.
  await expect(`${JSON.stringify(await modelText(), null, 2)}\n`).toMatchFileSnapshot("chat-tools.model-text.json");
});
