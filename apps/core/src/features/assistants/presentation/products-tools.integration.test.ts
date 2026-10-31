import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { signJWT } from "better-auth/plugins";
import { auth, authIssuer, mcpResourceUrl } from "@core/src/shared/infrastructure/auth";
import { log } from "@core/src/shared/infrastructure/logger";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { createAssistantMcpRoutes } from "@core/src/composition/assistant-server";
import { toolModules } from "@core/src/composition/assistant-tools";
import { deleteSeededProducts, seedProduct, type SeedProduct } from "@core/src/features/products/infrastructure/product-seed";

const suffix = randomUUID();
const clientId = `products-client-${suffix}`;
const day = 24 * 60 * 60 * 1000;

type Store = { companyId: string; userId: string; connectionId: string; subdomain: string };
const rosa: Store = { companyId: randomUUID(), userId: `rosa-${suffix}`, connectionId: randomUUID(), subdomain: `rosa${suffix.slice(0, 8)}` };
const luis: Store = { companyId: randomUUID(), userId: `luis-${suffix}`, connectionId: randomUUID(), subdomain: `luis${suffix.slice(0, 8)}` };

const mara: Store = { companyId: randomUUID(), userId: `mara-${suffix}`, connectionId: randomUUID(), subdomain: `mara${suffix.slice(0, 8)}` };

const servers: Server[] = [];
let base: string;
async function serve(): Promise<string> {
  const api = express();
  api.use(createAssistantMcpRoutes(toolModules));
  const server = api.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function mint(subject: string) {
  const now = Math.floor(Date.now() / 1000);
  return signJWT({ context: await auth.$context } as never, {
    options: {}, header: { typ: "at+jwt" },
    payload: { sub: subject, aud: mcpResourceUrl, client_id: clientId, azp: clientId, scope: "orders:read products:read offline_access", iss: authIssuer, iat: now, exp: now + 3600, jti: randomUUID() },
  } as never);
}

type Line = { combinacion: string; sku: string; buscada_por_sku?: boolean };
type Item = { id: string; nombre: string; en_catalogo: string; enlace: string; enlace_cliente?: string; variantes_coincidentes?: Line[] };
type Output = { catalogo: string; total: number; mensaje?: string; productos: Item[]; id?: string; variantes: Line[] };
type ToolResult = { isError?: boolean; structuredContent?: Output; content: { text: string }[] };
async function call(store: Store, name: string, args: unknown = {}): Promise<ToolResult> {
  const response = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18", authorization: `Bearer ${await mint(store.userId)}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const text = await response.text();
  const data = response.headers.get("content-type")?.includes("text/event-stream") ? text.split("\n").find((line) => line.startsWith("data:"))?.slice(5) ?? "" : text;
  const body = JSON.parse(data);
  if (!body.result) throw new Error(`${response.status} ${data}`);
  return body.result;
}

async function createStore(store: Store, name: string, catalog: { published: boolean; linked: boolean }) {
  await withTenantIsolation(store.companyId, async () => {
    await prisma.company.create({ data: { id: store.companyId, name, country: "PE", catalogPublished: catalog.published, catalogSubdomain: catalog.linked ? store.subdomain : null } });
    await systemPrisma.user.create({ data: { id: store.userId, name, email: `${store.userId}@example.test`, emailVerified: true, companyId: store.companyId } });
    await prisma.assistantConnection.create({ data: {
      id: store.connectionId, authorizedByUserId: store.userId, oauthClientId: clientId, agentName: "Claude", returnKind: "web", returnDomain: "claude.ai",
      scopes: ["orders:read", "products:read"], authorizedAt: new Date(Date.now() - 10 * day),
    } });
  });
}
const seed = (store: Store, product: SeedProduct) => withTenantIsolation(store.companyId, () => seedProduct(product));
const variant = (talla: string, color: string, salePrice: number, stock: number, sku: string, purchasePrice?: number) =>
  ({ attributes: { Talla: talla, Color: color }, salePrice, stock, sku, purchasePrice: purchasePrice ?? null });

let poloId: string;
let luisProductId: string;

beforeAll(async () => {
  expect(process.env.DATABASE_URL, "run sh scripts/run-tests.sh integration").toBeTruthy();
  base = await serve();
  await createStore(rosa, "Tienda Rosa", { published: true, linked: true });
  await createStore(luis, "Tienda Luis", { published: false, linked: true });
  await createStore(mara, "Tienda Mara", { published: false, linked: false });
  poloId = (await seed(rosa, { name: "Polo básico", createdAt: new Date("2026-10-01"), variants: [variant("M", "Azul", 39.9, 2, "POL-M-AZ", 20), variant("L", "Rojo", 45, 10, "POL-L-RJ")] })).productId;
  await seed(rosa, { name: "Casaca", createdAt: new Date("2026-10-02"), variants: [variant("M", "Azul", 120, 0, "CAS-M-AZ")] });
  luisProductId = (await seed(luis, { name: "Polo de Luis", variants: [variant("M", "Azul", 10, 5, "LUIS-1")] })).productId;
});

afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
  for (const store of [rosa, luis, mara]) {
    await withTenantIsolation(store.companyId, async () => {
      await deleteSeededProducts();
      await prisma.assistantConnection.deleteMany();
    });
    await systemPrisma.user.deleteMany({ where: { id: store.userId } });
    await withTenantIsolation(store.companyId, async () => await prisma.company.deleteMany({ where: { id: store.companyId } }));
  }
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await systemPrisma.$disconnect();
});

describe("product tools through the MCP server", () => {
  test("answers buscar_productos through the MCP server with the catalog line and customer links", async () => {
    const result = await call(rosa, "buscar_productos", { valores: ["azul", "m"], stock: "con stock" });
    expect(result.isError).toBeFalsy();
    const output = result.structuredContent!;
    expect(output.catalogo).toMatch(new RegExp(`^Tu catálogo está publicado en https?://${rosa.subdomain}\\.[^ ]+/\\.$`));
    expect(output.productos).toHaveLength(1);
    const [polo] = output.productos;
    expect(polo).toMatchObject({ id: poloId, nombre: "Polo básico", en_catalogo: "En el catálogo", enlace: `${authIssuer}/products/${poloId}` });
    expect(polo.enlace_cliente).toContain(`${rosa.subdomain}.`);
    expect(polo.enlace_cliente).toContain(`/productos/${poloId}`);
    expect(polo.variantes_coincidentes).toEqual([expect.objectContaining({ combinacion: "M / Azul", sku: "POL-M-AZ", stock: 2, nivel: "Stock bajo" })]);
    expect(JSON.stringify(output)).not.toContain("precio_compra");
    expect(JSON.stringify(output)).not.toContain("Luis");
  });

  test("answers the combined call polo, Rojo, con stock, precio hasta 50 and en el catálogo with Polo básico L / Rojo only", async () => {
    const result = await call(rosa, "buscar_productos", { texto: "polo", valores: ["Rojo"], stock: "con stock", precio_hasta: 50, en_catalogo: "sí" });
    expect(result.isError).toBeFalsy();
    const output = result.structuredContent!;
    expect(output.productos.map((item) => item.nombre)).toEqual(["Polo básico"]);
    expect(output.productos[0].variantes_coincidentes).toEqual([expect.objectContaining({ combinacion: "L / Rojo", sku: "POL-L-RJ" })]);
  });

  test("answers store A's no-match text for «polo verde» and an unknown-value text listing only A's values, never store B's", async () => {
    await seed(luis, { name: "Polo verde", variants: [variant("M", "Verde", 10, 5, "LUIS-VERDE"), variant("L", "Blanco", 10, 5, "LUIS-BLANCO")] });
    try {
      const none = await call(rosa, "buscar_productos", { texto: "polo verde" });
      expect(none.isError).toBeFalsy();
      expect(none.structuredContent).toMatchObject({ total: 0, productos: [] });
      expect(none.structuredContent!.mensaje).toContain("No hay productos con esos filtros");
      expect(none.structuredContent!.mensaje).toContain("polo verde");
      const unknown = await call(rosa, "buscar_productos", { valores: ["Verde"] });
      const text = JSON.stringify(unknown);
      expect(text).toContain("Azul");
      expect(text).toContain("Rojo");
      for (const foreign of ["Blanco", "Luis", "LUIS-VERDE"]) expect(text).not.toContain(foreign);
    } finally {
      // The other tests expect Luis to own only «Polo de Luis».
      await withTenantIsolation(luis.companyId, () => deleteSeededProducts());
      luisProductId = (await seed(luis, { name: "Polo de Luis", variants: [variant("M", "Azul", 10, 5, "LUIS-1")] })).productId;
    }
  });

  test("carries «Tu catálogo está oculto: ahora nadie ve tus productos.» and no customer link in a page and in an empty answer of a hidden catalog", async () => {
    const page = (await call(luis, "buscar_productos")).structuredContent!;
    expect(page.catalogo).toBe("Tu catálogo está oculto: ahora nadie ve tus productos.");
    expect(page.productos[0].enlace_cliente).toBeUndefined();
    const empty = (await call(luis, "buscar_productos", { texto: "zapato" })).structuredContent!;
    expect(empty).toMatchObject({ catalogo: "Tu catálogo está oculto: ahora nadie ve tus productos.", total: 0, productos: [] });
    expect(empty.mensaje).toContain("No hay productos con esos filtros");
  });

  test("answers ver_producto by SKU and by identifier, and another store's product as not found", async () => {
    const bySku = (await call(rosa, "ver_producto", { sku: "pol-m-az " })).structuredContent!;
    expect(bySku).toMatchObject({ id: poloId, nombre: "Polo básico" });
    expect(bySku.variantes).toHaveLength(2);
    expect(bySku.variantes.filter((line) => line.buscada_por_sku)).toEqual([expect.objectContaining({ sku: "POL-M-AZ", precio_compra: expect.stringContaining("20.00") })]);
    expect((await call(rosa, "ver_producto", { producto: poloId })).structuredContent).toMatchObject({ id: poloId });
    for (const args of [{ producto: luisProductId }, { sku: "LUIS-1" }, { producto: "no-es-un-uuid" }]) {
      const missing = await call(rosa, "ver_producto", args);
      expect(missing.isError).toBe(true);
      expect(missing.content[0].text).toBe("No encontré ese producto en tu tienda. Búscalo con Buscar productos.");
    }
  });

  test("answers «Tu tienda todavía no tiene productos.» in a store without products, also when values are sent", async () => {
    for (const args of [{}, { texto: "polo" }, { valores: ["Azul"] }, { valores: ["Talla: M"], precio_desde: 10, stock: "con stock" }]) {
      const result = await call(mara, "buscar_productos", args);
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({ catalogo: "Tu catálogo está oculto y no tiene link todavía.", total: 0, productos: [], mensaje: "Tu tienda todavía no tiene productos." });
    }
  });

  test("counts product calls in the store limit shared with order tools", async () => {
    const info = vi.spyOn(log, "info");
    // Mara has her own store, so using up her minute window touches no other test; fill it with mixed calls until one is refused.
    let refused: ToolResult | undefined;
    for (let attempt = 0; attempt < 70 && !refused; attempt++) {
      const result = await call(mara, attempt % 2 === 0 ? "buscar_productos" : "pedidos_por_cobrar", attempt % 2 === 0 ? { texto: "polo" } : {});
      if (result.isError && /límite de 60 consultas/.test(result.content[0].text)) refused = result;
    }
    expect(refused).toBeDefined();
    const tools = info.mock.calls.map(([fields]) => fields as { event?: string; tool?: string; outcome?: string }).filter((fields) => fields.event === "assistant_tool_called");
    expect(tools.some((fields) => fields.tool === "buscar_productos" && fields.outcome !== "rate_limited")).toBe(true);
    expect(tools.some((fields) => fields.tool === "pedidos_por_cobrar")).toBe(true);
    expect(tools.at(-1)).toMatchObject({ outcome: "rate_limited" });
    // Another store keeps answering: the limit is per store.
    const other = await call(luis, "buscar_productos", { texto: "polo" });
    expect(other.isError).toBeFalsy();
    expect(other.structuredContent?.productos).toHaveLength(1);
  }, 60_000);

  test("leaves every product, price and stock unchanged after any sequence of calls", async () => {
    const snapshot = (store: Store) => withTenantIsolation(store.companyId, async () => ({
      products: await prisma.product.findMany({ orderBy: { id: "asc" } }),
      variants: await prisma.productVariant.findMany({ orderBy: { id: "asc" } }),
      stock: await prisma.productStock.findMany({ orderBy: { variantId: "asc" } }),
    }));
    const stores = [rosa, luis];
    const before = await Promise.all(stores.map(snapshot));
    expect(before[0].products.length).toBeGreaterThan(0);
    expect(before[1].products.length).toBeGreaterThan(0);
    // Each account calls both tools on its own store, the second round hitting the first one's results.
    for (const store of stores) {
      expect((await call(store, "buscar_productos", { texto: "polo", valores: ["Azul"], stock: "con stock" })).isError).toBeFalsy();
      expect((await call(store, "buscar_productos", { en_catalogo: "sí", orden: "nombre" })).isError).toBeFalsy();
      expect((await call(store, "ver_producto", { sku: store === rosa ? "pol-m-az" : "luis-1" })).isError).toBeFalsy();
    }
    expect(await Promise.all(stores.map(snapshot))).toEqual(before);
  });
});
