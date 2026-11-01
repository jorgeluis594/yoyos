import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { AssistantAccess } from "@core/src/features/assistants/application/resolve-assistant-access";
import type { RegisteredTool, ToolRun, ToolRunError } from "@core/src/features/assistants/application/answer-tool-call";
import type { ToolModule } from "@core/src/features/assistants/presentation/tool-module";
import { maxCombination, maxProductName, type Display } from "@core/src/features/assistants/domain/order-projection";
import {
  catalogLine, emptySearchMessage, maxDescription, maxSearchSku, moreProductsLine, toAssistantProduct, toAssistantProductSummary, vocabularyMessage,
  type AssistantProduct, type AssistantProductSummary, type InCatalogLine, type AssistantVariantMatch, type ProductProjectionContext, type ProjectableProduct, type ProjectableProductSummary, type ProjectableStorefront,
  type ProjectableValueRejection,
} from "@core/src/features/assistants/domain/product-projection";
import { display as defaultDisplay } from "@core/src/features/assistants/presentation/display";
import {
  noProductMessage, pageOutOfRangeMessage, productReadFailureMessage, productToolsInstructions, reversedPriceMessage, searchProductsDescription,
  unknownFieldMessage, viewProductDescription,
} from "@core/src/features/assistants/presentation/tools/products-texts";

type Failure = ToolRunError;
type Read<T> = Promise<Result<T, Failure>>;

/** The plain request a search sends to the products feature, which parses it inside its own use case. */
export type ProductSearchRequest = Readonly<{
  text?: string;                                  // trimmed, 1..120 characters
  values?: readonly [string, ...string[]];        // raw «Azul» or «Color: Azul», at most 3, each trimmed
  priceFromCents?: number; priceToCents?: number; // safe non-negative integers, validated to two decimals by the input schema
  stock?: "in_stock" | "low" | "sold_out";
  inCatalog?: boolean;
  sort: "recent" | "name";
  page: number;
}>;
export type ProductSearchAnswer = Readonly<{ storefront: ProjectableStorefront }> & (
  | Readonly<{ kind: "page"; items: readonly ProjectableProductSummary[]; page: number; total: number; storeHasProducts: boolean }>
  | Readonly<{ kind: "price_range_reversed" }>
  | Readonly<{ kind: "value_rejected"; rejection: ProjectableValueRejection }>);
export type ProductReferenceRequest = Readonly<{ by: "id"; id: string }> | Readonly<{ by: "sku"; sku: string }>;

/** What the product tools need of products and catalog; `src/composition/assistant-product-capabilities.ts` wires the composed operations. Refusals come back as tool errors. */
export type ProductToolsDependencies = Readonly<{
  appLink: (productId: string) => string;                                       // `${authIssuer}/products/<id>`
  search: (request: ProductSearchRequest, access: AssistantAccess) => Read<ProductSearchAnswer>;
  find: (reference: ProductReferenceRequest, access: AssistantAccess) => Read<Readonly<{ storefront: ProjectableStorefront; product: ProjectableProduct | null }>>;
}>;

const maxNameLength = 30;
const maxAmount = 999_999_999.99;
const unknownField = { error: (issue: { code: string; keys?: string[] }) => issue.code === "unrecognized_keys" ? unknownFieldMessage((issue.keys ?? []).join(", ")) : undefined };

const page = z.number({ error: "La página debe ser un número entero." }).int("La página debe ser un número entero.").min(1, "La página empieza en 1.").default(1);
const valueEntry = z.string({ error: "valores debe ser una lista de textos, por ejemplo [\"Azul\", \"Talla: M\"]." }).trim().min(1, "Cada entrada de valores necesita un texto.")
  .refine((entry) => {
    const colon = entry.indexOf(":");
    const names = colon < 0 ? [entry] : [entry.slice(0, colon), entry.slice(colon + 1)];
    return names.every((name) => [...name.trim()].length <= maxNameLength);
  }, `Cada nombre de valores admite como máximo ${maxNameLength} caracteres.`);
const twoDecimals = (amount: number) => Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-6;
const amount = (field: string) => z.number({ error: `${field} debe ser un monto, por ejemplo 39.90.` })
  .min(0, `${field} no puede ser negativo.`).max(maxAmount, `${field} no puede pasar de ${maxAmount}.`).refine(twoDecimals, `${field} admite como máximo dos decimales, por ejemplo 39.90.`);

const searchInput = z.strictObject({
  texto: z.string({ error: "texto debe ser un texto." }).trim().max(120, "texto admite como máximo 120 caracteres.").optional(),
  valores: z.array(valueEntry, { error: "valores debe ser una lista de textos, por ejemplo [\"Azul\", \"Talla: M\"]." })
    .min(1, "valores necesita al menos una entrada; quítalo si no filtras por valores.")
    .max(3, "valores admite como máximo 3 entradas. Envía los valores más específicos y filtra el resto al responder.").optional(),
  precio_desde: amount("precio_desde").optional(),
  precio_hasta: amount("precio_hasta").optional(),
  stock: z.enum(["con stock", "stock bajo", "agotado"], { error: 'stock admite "con stock", "stock bajo" o "agotado".' }).optional(),
  en_catalogo: z.enum(["sí", "si", "no"], { error: 'en_catalogo admite "sí" o "no".' }).optional(),
  orden: z.enum(["recientes", "nombre"], { error: 'orden admite "recientes" o "nombre".' }).default("recientes"),
  pagina: page,
}, unknownField);

const exactlyOne = "Indica exactamente uno: producto (el id que devuelve buscar_productos) o sku.";
const viewInput = z.strictObject({
  producto: z.string({ error: "producto debe ser un texto." }).trim().min(1, "producto no puede estar vacío.").max(100, "producto admite como máximo 100 caracteres.").optional(),
  sku: z.string({ error: "sku debe ser un texto." }).trim().min(1, "sku no puede estar vacío.").max(100, "sku admite como máximo 100 caracteres.").optional(),
}, unknownField).refine((input) => (input.producto === undefined) !== (input.sku === undefined), exactlyOne);

const text = z.string();
const level = z.enum(["Agotado", "Stock bajo"]);
const inCatalog = z.enum([
  "En el catálogo", "No está en el catálogo: producto oculto", "No está en el catálogo: producto oculto y sin variantes activas", "No está en el catálogo: sin variantes activas",
]) satisfies z.ZodType<InCatalogLine>;
const matchSchema = z.strictObject({ combinacion: text, sku: text, precio: text, stock: z.number(), nivel: level.optional() });
const summarySchema = z.strictObject({
  id: text, nombre: text, sku: text, precio: text, stock: text.optional(), en_catalogo: inCatalog, variantes: text, enlace: text, enlace_cliente: text.optional(),
  variantes_coincidentes: z.array(matchSchema).readonly().optional(), mas_variantes: text.optional(),
}) satisfies z.ZodType<AssistantProductSummary>;
const searchOutput = z.strictObject({ catalogo: text, pagina: z.number(), total: z.number(), hay_mas: text.optional(), mensaje: text.optional(), productos: z.array(summarySchema).readonly() });
const productOutput = z.strictObject({
  catalogo: text, id: text, nombre: text, descripcion: text.optional(), opciones: z.array(z.strictObject({ nombre: text, valores: z.array(text).readonly() })).readonly(),
  en_catalogo: inCatalog, stock: text.optional(), enlace: text, enlace_cliente: text.optional(),
  variantes: z.array(z.strictObject({
    combinacion: text, sku: text, precio: text, precio_compra: text, stock: z.number(), nivel: level.optional(), estado: z.enum(["Activa", "Desactivada"]), buscada_por_sku: z.literal(true).optional(),
  })).readonly(),
}) satisfies z.ZodType<AssistantProduct>;

const invalid = (message: string): Failure => ({ code: "INVALID_INPUT", message });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const stockLevels = { "con stock": "in_stock", "stock bajo": "low", "agotado": "sold_out" } as const;

type SearchInput = z.output<typeof searchInput>;

function requestOf(input: SearchInput): ProductSearchRequest {
  const [first, ...rest] = input.valores ?? [];
  return {
    ...input.texto ? { text: input.texto } : {},
    ...first === undefined ? {} : { values: [first, ...rest] as const },
    ...input.precio_desde === undefined ? {} : { priceFromCents: Math.round(input.precio_desde * 100) },
    ...input.precio_hasta === undefined ? {} : { priceToCents: Math.round(input.precio_hasta * 100) },
    ...input.stock === undefined ? {} : { stock: stockLevels[input.stock] },
    ...input.en_catalogo === undefined ? {} : { inCatalog: input.en_catalogo !== "no" },
    sort: input.orden === "nombre" ? "name" : "recent", page: input.pagina,
  };
}

export type ProductToolsOptions = Readonly<{ display?: Display }>;

export function createProductToolsModule(deps: ProductToolsDependencies, options: ProductToolsOptions = {}): ToolModule {
  const display = options.display ?? defaultDisplay;
  const context: ProductProjectionContext = { display, appLink: deps.appLink };

  const searchProducts: RegisteredTool<SearchInput, z.output<typeof searchOutput>> = {
    name: "buscar_productos", title: "Buscar productos", description: searchProductsDescription, inputSchema: searchInput, outputSchema: searchOutput,
    sampleOutputs: [sampleSearchOutput(false), sampleSearchOutput(true)],
    async run(input, access): Promise<ToolRun<z.output<typeof searchOutput>>> {
      const request = requestOf(input);
      const answer = await deps.search(request, access);
      if (!answer.success) return answer;
      const { storefront } = answer.data;
      switch (answer.data.kind) {
        case "price_range_reversed": {
          const money = (cents: number | undefined) => display.money({ amount: (cents ?? 0) / 100, currency: storefront.currency });
          return err(invalid(reversedPriceMessage(money(request.priceToCents), money(request.priceFromCents))));
        }
        case "value_rejected": return err(invalid(vocabularyMessage(answer.data.rejection)));
        case "page": {
          const { items, page: current, total, storeHasProducts } = answer.data;
          const frame = { catalogo: catalogLine(storefront), pagina: current, total };
          if (items.length === 0) {
            const message = total > 0 ? pageOutOfRangeMessage(total) : emptySearchMessage(request, storefront.currency, storeHasProducts, display);
            return ok({ output: { ...frame, mensaje: message, productos: [] }, empty: true });
          }
          const more = moreProductsLine(current, total);
          return ok({ output: { ...frame, ...more === undefined ? {} : { hay_mas: more }, productos: items.map((item) => toAssistantProductSummary(item, context)) }, empty: false });
        }
      }
    },
  };

  const viewProduct: RegisteredTool<z.output<typeof viewInput>, z.output<typeof productOutput>> = {
    name: "ver_producto", title: "Ver producto", description: viewProductDescription, inputSchema: viewInput, outputSchema: productOutput,
    sampleOutputs: [sampleProductOutput(60)],
    async run(input, access) {
      const notFound = err<Failure>({ code: "NOT_FOUND", message: noProductMessage });
      let reference: ProductReferenceRequest;
      if (input.producto !== undefined) {
        // A product identifier that is not a UUID cannot exist: it answers like an unknown product, without a read.
        if (!uuid.test(input.producto)) return notFound;
        reference = { by: "id", id: input.producto.toLowerCase() };
      } else {
        reference = { by: "sku", sku: input.sku ?? "" };
      }
      const found = await deps.find(reference, access);
      if (!found.success) return found;
      if (found.data.product === null) return notFound;
      return ok({ output: toAssistantProduct(found.data.product, found.data.storefront, context), empty: false });
    },
  };

  return { scope: "products:read", access: "read", instructions: productToolsInstructions, readFailureMessage: productReadFailureMessage, tools: [searchProducts, viewProduct] };
}

// Sample outputs for the static validator: maximum-length ASCII texts, so the 24 KB budget is checked on realistic worst cases.
const long = (length: number, seed = "x") => seed.repeat(length).slice(0, length);
const uuidSample = "0123abcd-0000-4000-8000-000000000000";
const storeLink = "https://tienda-con-un-nombre-largo.yoyos.lat";

function sampleSummary(withMatches: boolean): AssistantProductSummary {
  return {
    id: uuidSample, nombre: long(maxProductName, "Polo "), sku: long(maxSearchSku, "SKU"), precio: "Desde S/ 99,999,999.00", stock: "Stock: 99999 · 99 agotadas, 99 con stock bajo",
    en_catalogo: "En el catálogo", variantes: "100 variantes, 99 desactivadas", enlace: `https://app.yoyos.lat/products/${uuidSample}`, enlace_cliente: `${storeLink}/productos/${uuidSample}`,
    ...withMatches ? { variantes_coincidentes: Array.from({ length: 3 }, (): AssistantVariantMatch => ({
      combinacion: long(maxCombination, "M / Azul "), sku: long(maxSearchSku, "SKU"), precio: "S/ 99,999,999.00", stock: 99999, nivel: "Stock bajo",
    })), mas_variantes: "y 97 variantes más: usa Ver producto" } : {},
  };
}
function sampleSearchOutput(withMatches: boolean): z.output<typeof searchOutput> {
  return {
    catalogo: `Tu catálogo está publicado en ${storeLink}/.`, pagina: 1, total: 21, hay_mas: "hay más: pide la página 2",
    productos: Array.from({ length: 20 }, () => sampleSummary(withMatches)),
  };
}
function sampleProductOutput(variantCount: number): z.output<typeof productOutput> {
  return {
    catalogo: `Tu catálogo está publicado en ${storeLink}/.`, id: uuidSample, nombre: long(maxProductName, "Polo "),
    descripcion: `${long(maxDescription, "Algodón pima ")}… (la descripción continúa en Yoyos)`,
    opciones: ["Talla", "Color", "Material"].map((name) => ({ nombre: long(maxNameLength, name), valores: Array.from({ length: 10 }, (_, index) => long(maxNameLength - 2, `${index}v`)) })),
    en_catalogo: "En el catálogo", stock: "Stock: 99999 · 99 agotadas, 99 con stock bajo", enlace: `https://app.yoyos.lat/products/${uuidSample}`, enlace_cliente: `${storeLink}/productos/${uuidSample}`,
    variantes: Array.from({ length: variantCount }, (_, index) => ({
      combinacion: long(maxCombination, "M / Azul "), sku: long(100, `SKU${index}`), precio: "S/ 99,999,999.00", precio_compra: "S/ 99,999,999.00", stock: 99999, nivel: "Stock bajo" as const,
      estado: "Desactivada" as const, buscada_por_sku: true as const,
    })),
  };
}
