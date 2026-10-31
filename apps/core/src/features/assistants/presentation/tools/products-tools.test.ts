import { describe, expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import type { CompanyId, UserId } from "@shared/identity";
import type { AssistantConnectionId } from "@core/src/features/assistants/domain/assistant-connection";
import type { AssistantAccess } from "@core/src/features/assistants/application/resolve-assistant-access";
import type { ProjectableProduct, ProjectableProductSummary, ProjectableStorefront } from "@core/src/features/assistants/domain/product-projection";
import { checkToolModules, maxToolOutputBytes } from "@core/src/features/assistants/presentation/tool-registry";
import { createProductToolsModule, type ProductSearchAnswer, type ProductToolsDependencies } from "@core/src/features/assistants/presentation/tools/products-tools";
import { productReadFailureMessage } from "@core/src/features/assistants/presentation/tools/products-texts";

const access: AssistantAccess = {
  companyId: "6c0f5d2e-6a63-4a38-9f07-3b8f7a1c0002" as CompanyId, userId: "user-1" as UserId,
  connectionId: "6c0f5d2e-6a63-4a38-9f07-3b8f7a1c0001" as AssistantConnectionId, scopes: ["orders:read", "products:read"], lastUsedAt: null,
};
const pen = (amount: number) => ({ amount, currency: "PEN" as const });
const published: ProjectableStorefront = { currency: "PEN", catalog: { kind: "published", storeLink: "https://rosa.yoyos.lat/" } };
const productId = "00000000-0000-4000-8000-000000000001";

const summary = (overrides: Partial<ProjectableProductSummary> = {}): ProjectableProductSummary => ({
  id: productId, name: "Polo básico", variantCount: 2, inactiveCount: 0, customerLink: `https://rosa.yoyos.lat/productos/${productId}`, matching: null,
  active: { kind: "some", minSalePrice: pen(39.9), hasDifferentPrices: true, totalStock: 12, soldOut: 0, low: 1, onlyLevel: null, sku: { kind: "several" } }, ...overrides,
});
const detail = (variantCount = 1, text = "x"): ProjectableProduct => ({
  id: productId, name: text.repeat(100), description: text.repeat(1000), options: [{ name: "Talla", values: ["M", "L"] }], customerLink: null,
  active: { kind: "some", minSalePrice: pen(39.9), hasDifferentPrices: false, totalStock: 99, soldOut: 0, low: 0, onlyLevel: null, sku: { kind: "several" } },
  variants: Array.from({ length: variantCount }, (_, index) => ({
    values: [text.repeat(24), text.repeat(25)], sku: text.repeat(95) + String(index).padStart(5, "0"), salePrice: pen(99_999_999), purchasePrice: pen(99_999_999), stock: 99_999,
    level: "available" as const, isActive: false, searched: true,
  })),
});

function dependencies(overrides: Partial<ProductToolsDependencies> = {}) {
  const search = vi.fn(async (): Promise<Awaited<ReturnType<ProductToolsDependencies["search"]>>> => ok({ storefront: published, kind: "page", items: [summary()], page: 1, total: 1, storeHasProducts: true }));
  const find = vi.fn(async (): Promise<Awaited<ReturnType<ProductToolsDependencies["find"]>>> => ok({ storefront: published, product: detail() }));
  const deps: ProductToolsDependencies = { appLink: (id) => `https://app.yoyos.lat/products/${id}`, search, find, ...overrides };
  const module = createProductToolsModule(deps);
  const tool = (name: string) => module.tools.find((candidate) => candidate.name === name)!;
  const run = async (name: string, raw: unknown) => {
    const selected = tool(name);
    const parsed = selected.inputSchema.safeParse(raw);
    if (!parsed.success) return { parsed } as const;
    return { parsed, run: await selected.run(parsed.data, access) } as const;
  };
  return { module, search, find, run, tool };
}

const messageOf = (parsed: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  (parsed.error?.issues ?? []).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(" ");

describe("buscar_productos", () => {
  test("maps «stock bajo», «sí», 39.9 and «Color: Azul» to the search request", async () => {
    const { run, search } = dependencies();
    await run("buscar_productos", { texto: " polo ", valores: ["Color: Azul", " M "], precio_hasta: 39.9, precio_desde: 0.07, stock: "stock bajo", en_catalogo: "sí", orden: "nombre", pagina: 2 });
    expect(search).toHaveBeenCalledWith({
      text: "polo", values: ["Color: Azul", "M"], priceFromCents: 7, priceToCents: 3990, stock: "low", inCatalog: true, sort: "name", page: 2,
    }, access);
    await run("buscar_productos", { stock: "con stock", en_catalogo: "no" });
    expect(search).toHaveBeenLastCalledWith({ stock: "in_stock", inCatalog: false, sort: "recent", page: 1 }, access);
    await run("buscar_productos", { stock: "agotado", en_catalogo: "si", texto: "" });
    expect(search).toHaveBeenLastCalledWith({ stock: "sold_out", inCatalog: true, sort: "recent", page: 1 }, access);
  });

  test("refuses more than three values with the field and the remedy", async () => {
    const { run } = dependencies();
    const { parsed } = await run("buscar_productos", { valores: ["a", "b", "c", "d"] });
    expect(parsed.success).toBe(false);
    expect(messageOf(parsed as never)).toBe("valores: valores admite como máximo 3 entradas. Envía los valores más específicos y filtra el resto al responder.");
  });

  test("refuses amounts that are negative, have more than two decimals or are not numbers, and unknown fields", async () => {
    const { run } = dependencies();
    expect(messageOf((await run("buscar_productos", { precio_desde: -1 })).parsed as never)).toContain("precio_desde no puede ser negativo");
    expect(messageOf((await run("buscar_productos", { precio_hasta: 10.005 })).parsed as never)).toContain("como máximo dos decimales");
    expect(messageOf((await run("buscar_productos", { precio_hasta: "barato" })).parsed as never)).toContain("debe ser un monto");
    expect(messageOf((await run("buscar_productos", { categoria: "polos" })).parsed as never)).toContain("No existe el campo categoria");
    expect(messageOf((await run("buscar_productos", { valores: ["x".repeat(31)] })).parsed as never)).toContain("30 caracteres");
    expect(messageOf((await run("buscar_productos", { valores: ["Color: " + "x".repeat(31)] })).parsed as never)).toContain("30 caracteres");
    expect((await run("buscar_productos", { valores: ["Color: " + "x".repeat(30)], precio_hasta: 39.9 })).parsed.success).toBe(true);
  });

  test("answers a page with the catalog line, the items and «hay más»", async () => {
    const { run } = dependencies({ search: async () => ok({ storefront: published, kind: "page", items: [summary()], page: 1, total: 45, storeHasProducts: true }) });
    const { run: result } = await run("buscar_productos", {});
    expect(result?.success && result.data.empty).toBe(false);
    expect(result?.success && result.data.output).toMatchObject({ catalogo: "Tu catálogo está publicado en https://rosa.yoyos.lat/.", pagina: 1, total: 45, hay_mas: "hay más: pide la página 2" });
  });

  test("answers «Tu tienda todavía no tiene productos.» with the catalog line in an empty store", async () => {
    const { run } = dependencies({ search: async () => ok({ storefront: { currency: "PEN", catalog: { kind: "hidden_without_link" } }, kind: "page", items: [], page: 1, total: 0, storeHasProducts: false }) });
    const { run: result } = await run("buscar_productos", { texto: "polo" });
    expect(result?.success && result.data).toEqual({ empty: true, output: { catalogo: "Tu catálogo está oculto y no tiene link todavía.", pagina: 1, total: 0, mensaje: "Tu tienda todavía no tiene productos.", productos: [] } });
  });

  test("answers «No hay productos con esos filtros: …» with the applied filters", async () => {
    const { run } = dependencies({ search: async () => ok({ storefront: published, kind: "page", items: [], page: 1, total: 0, storeHasProducts: true }) });
    const { run: result } = await run("buscar_productos", { precio_hasta: 30 });
    expect(result?.success && result.data.output).toMatchObject({ mensaje: "No hay productos con esos filtros: precio hasta S/ 30.00." });
  });

  test("answers a page past the last one with the total instead of a filter message", async () => {
    const { run } = dependencies({ search: async () => ok({ storefront: published, kind: "page", items: [], page: 9, total: 45, storeHasProducts: true }) });
    const { run: result } = await run("buscar_productos", { pagina: 9 });
    expect(result?.success && result.data.output).toMatchObject({ mensaje: "Esa página no existe: hay 45 productos en total, 20 por página." });
  });

  test("turns the refusals of the search into invalid input with the draft texts", async () => {
    const answer = (partial: object) => async () => ok({ storefront: published, ...partial } as ProductSearchAnswer);
    const reversed = await dependencies({ search: answer({ kind: "price_range_reversed" }) }).run("buscar_productos", { precio_desde: 50, precio_hasta: 20 });
    expect(reversed.run).toEqual(err({ code: "INVALID_INPUT", message: "El precio hasta (S/ 20.00) es menor que el precio desde (S/ 50.00)." }));
    const outside = await dependencies({ search: answer({ kind: "variant_filter_outside_catalog" }) }).run("buscar_productos", { en_catalogo: "no", stock: "agotado" });
    expect(outside.run).toEqual(err({ code: "INVALID_INPUT", message: "Los filtros de variante (valores, precio y stock) solo miran variantes activas, y los productos que no están en el catálogo no tienen ninguna. Quita esos filtros o en_catalogo." }));
    const rejected = await dependencies({ search: answer({ kind: "value_rejected", rejection: { kind: "no_options" } }) }).run("buscar_productos", { valores: ["Azul"] });
    expect(rejected.run).toEqual(err({ code: "INVALID_INPUT", message: "Ningún producto de tu tienda tiene opciones (como color o talla). Busca con texto." }));
  });

  test("passes a failed read through", async () => {
    const failure = err({ code: "FAILURE" as const, message: productReadFailureMessage });
    expect((await dependencies({ search: async () => failure }).run("buscar_productos", {})).run).toBe(failure);
  });

  test("says in the Buscar productos description that Yoyos has no categories, with «polo» and «casac» written literally", () => {
    const { tool } = dependencies();
    const description = tool("buscar_productos").description;
    expect(description).toContain("Yoyos no tiene categorías");
    expect(description).toContain("«polo» para «polos»");
    expect(description).toContain("«casac» para «casacas»");
    expect(description).toContain("prueba con una más corta");
    expect(description).toContain("una sola frase");
  });

  test("tells the agent in the module paragraph that the purchase price is not for customers, stock is not a reservation and a hidden catalog is mentioned once", () => {
    const { module } = dependencies();
    expect(module.instructions).toContain("no calcules márgenes");
    expect(module.instructions).toContain("no una reserva");
    expect(module.instructions).toContain("una sola vez en la conversación");
    expect(module.instructions).toContain("no tiene categorías");
    expect(checkToolModules([module])).toEqual([]);
  });
});

describe("ver_producto", () => {
  test("refuses ver_producto with both producto and sku, and with neither", async () => {
    const { run } = dependencies();
    for (const input of [{ producto: productId, sku: "POL" }, {}]) {
      const { parsed } = await run("ver_producto", input);
      expect(parsed.success).toBe(false);
      expect(messageOf(parsed as never)).toContain("Indica exactamente uno: producto");
    }
    expect(messageOf((await run("ver_producto", { producto: productId, extra: 1 })).parsed as never)).toContain("No existe el campo extra");
  });

  test("answers a non-UUID product identifier like an unknown product without reading", async () => {
    const { run, find } = dependencies();
    const { run: result } = await run("ver_producto", { producto: "no-es-un-id" });
    expect(result).toEqual(err({ code: "NOT_FOUND", message: "No encontré ese producto en tu tienda. Búscalo con Buscar productos." }));
    expect(find).not.toHaveBeenCalled();
  });

  test("reads by identifier in lower case and by SKU as written", async () => {
    const { run, find } = dependencies();
    await run("ver_producto", { producto: productId.toUpperCase() });
    expect(find).toHaveBeenLastCalledWith({ by: "id", id: productId }, access);
    await run("ver_producto", { sku: " pol-m-az " });
    expect(find).toHaveBeenLastCalledWith({ by: "sku", sku: "pol-m-az" }, access);
  });

  test("answers an unknown product or SKU as not found", async () => {
    const { run } = dependencies({ find: async () => ok({ storefront: published, product: null }) });
    expect((await run("ver_producto", { sku: "NO-EXISTE" })).run).toEqual(err({ code: "NOT_FOUND", message: "No encontré ese producto en tu tienda. Búscalo con Buscar productos." }));
  });

  test("answers a product of 60 variants with two-byte text at maximum lengths complete", async () => {
    const { run, tool } = dependencies({ find: async () => ok({ storefront: published, product: detail(60, "ñ") }) });
    const { run: result } = await run("ver_producto", { producto: productId });
    expect(result?.success).toBe(true);
    const output = result?.success ? result.data.output : null;
    expect((output as { variantes: unknown[] }).variantes).toHaveLength(60);
    expect(tool("ver_producto").outputSchema.safeParse(output).success).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(output))).toBeGreaterThan(maxToolOutputBytes);
  });
});

describe("the sample outputs", () => {
  test("stay within 24 KB with maximum ASCII lengths and validate against their schemas", () => {
    const { module } = dependencies();
    for (const tool of module.tools) tool.sampleOutputs.forEach((sample) => {
      expect(tool.outputSchema.safeParse(sample).success).toBe(true);
      expect(Buffer.byteLength(JSON.stringify(sample))).toBeLessThan(maxToolOutputBytes);
    });
    expect(module.tools.map((tool) => tool.name)).toEqual(["buscar_productos", "ver_producto"]);
  });
});
