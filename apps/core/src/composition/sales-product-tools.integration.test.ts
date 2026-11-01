import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { Prisma } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { signJWT } from "better-auth/plugins";
import { auth, authIssuer, mcpResourceUrl } from "@core/src/shared/infrastructure/auth";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { createAssistantMcpRoutes } from "@core/src/composition/assistant-server";
import { toolModules } from "@core/src/composition/assistant-tools";
import { salesPathStatements } from "@core/src/features/orders/infrastructure/sales-read";
import { seedProduct, type SeedProduct } from "@core/src/features/products/infrastructure/product-seed";

const suffix = randomUUID();
const clientId = `sales-products-client-${suffix}`;
const day = 24 * 60 * 60 * 1000;

type Store = { companyId: string; userId: string; connectionId: string };
const rosa: Store = { companyId: randomUUID(), userId: `rosa-${suffix}`, connectionId: randomUUID() };
const luis: Store = { companyId: randomUUID(), userId: `luis-${suffix}`, connectionId: randomUUID() };

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

type Variant = { combinacion: string; unidades: number; monto: string };
type Item = { id: string; nombre: string; unidades?: number; monto?: string; participacion?: string; variantes?: Variant[]; mas_variantes?: string; stock?: string; fechas?: string; enlace: string };
type Output = { hoy: string; resumen?: string; mensaje?: string; nota?: string; aviso?: string; total: number; productos: Item[]; otras_monedas?: string[] };
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

/** The statements the sales snapshot ran: every statement between the repeatable-read BEGIN and its COMMIT, transaction control not counted (memory 03011cbe). */
async function countSnapshotStatements<T>(work: () => Promise<T>): Promise<{ result: T; statements: number[] }> {
  const pg = await import("pg");
  const original = pg.Client.prototype.query;
  const open = new Map<unknown, { count: number; snapshot: boolean }>();
  const statements: number[] = [];
  const spy = vi.spyOn(pg.Client.prototype, "query").mockImplementation(function (this: unknown, ...args: unknown[]) {
    const first = args[0];
    const text = typeof first === "string" ? first : (first as { text?: string } | undefined)?.text ?? "";
    if (/^\s*BEGIN/i.test(text)) open.set(this, { count: 0, snapshot: false });
    else if (/^\s*SET TRANSACTION ISOLATION LEVEL REPEATABLE READ/i.test(text)) { const entry = open.get(this); if (entry) entry.snapshot = true; }
    else if (/^\s*(COMMIT|ROLLBACK)/i.test(text)) { const entry = open.get(this); if (entry?.snapshot) statements.push(entry.count); open.delete(this); }
    else if (!/^\s*(SAVEPOINT|RELEASE|SET TRANSACTION)/i.test(text)) { const entry = open.get(this); if (entry) entry.count += 1; }
    return (original as (...rest: unknown[]) => unknown).apply(this, args);
  } as never);
  try { return { result: await work(), statements }; } finally { spy.mockRestore(); }
}

async function createStore(store: Store, name: string) {
  await withTenantIsolation(store.companyId, async () => {
    await prisma.company.create({ data: { id: store.companyId, name, country: "PE" } });
    await systemPrisma.user.create({ data: { id: store.userId, name, email: `${store.userId}@example.test`, emailVerified: true, companyId: store.companyId } });
    await prisma.assistantConnection.create({ data: {
      id: store.connectionId, authorizedByUserId: store.userId, oauthClientId: clientId, agentName: "Claude", returnKind: "web", returnDomain: "claude.ai",
      scopes: ["orders:read", "products:read"], authorizedAt: new Date(Date.now() - 10 * day),
    } });
  });
}
const seed = (store: Store, product: SeedProduct) => withTenantIsolation(store.companyId, () => seedProduct(product));
const variant = (talla: string, color: string, stock: number, sku: string, status: "active" | "inactive" = "active") => ({ attributes: { Talla: talla, Color: color }, stock, sku, status });

let orderNumber = 1000;
type SoldItem = Readonly<{ variant: string; quantity: number; unitPrice: number }>;
async function sell(store: Store, createdAt: string, items: readonly SoldItem[], extra: Readonly<{ charge?: number; cancelled?: boolean; unconfirmedCatalog?: boolean; currency?: "PEN" | "USD" }> = {}) {
  const created = new Date(createdAt);
  const total = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  await withTenantIsolation(store.companyId, async () => {
    const id = randomUUID();
    await prisma.order.create({ data: { id, number: BigInt(++orderNumber), currency: extra.currency ?? "PEN", total: new Prisma.Decimal(total + (extra.charge ?? 0)), itemsTotal: new Prisma.Decimal(total),
      deliveryCharge: new Prisma.Decimal(extra.charge ?? 0), deliveryCost: new Prisma.Decimal(extra.charge ?? 0), createdAt: created, cancelled: extra.cancelled ?? false, cancelledAt: extra.cancelled ? created : null,
      fromCatalog: extra.unconfirmedCatalog ?? false, checkoutEnabledAt: extra.unconfirmedCatalog ? created : null, sellerId: extra.unconfirmedCatalog ? null : store.userId } });
    for (const item of items) await prisma.orderItem.create({ data: { orderId: id, orderCreatedAt: created, variantId: item.variant, productName: "x", variantAttributes: {}, quantity: BigInt(item.quantity),
      unitPrice: new Prisma.Decimal(item.unitPrice), subtotal: new Prisma.Decimal(item.quantity * item.unitPrice) } });
  });
}

let poloId: string, casacaId: string, gorroId: string, bufandaId: string, estampadoId: string, luisId: string;
const october = { desde: "2026-10-01", hasta: "2026-10-31" };

beforeAll(async () => {
  expect(process.env.DATABASE_URL, "run sh scripts/run-tests.sh integration").toBeTruthy();
  // «Hoy es 05/11/2026»: October of the example has ended.
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-05T15:00:00Z") });
  base = await serve();
  await createStore(rosa, "Tienda Rosa");
  await createStore(luis, "Tienda Luis");
  const polo = await seed(rosa, { name: "Polo básico", createdAt: new Date("2026-01-01"), variants: [variant("M", "Azul", 12, "POL-M-AZ"), variant("L", "Negro", 8, "POL-L-NG"), variant("S", "Blanco", 0, "POL-S-BL")] });
  const casaca = await seed(rosa, { name: "Casaca", createdAt: new Date("2026-01-01"), variants: [variant("M", "Negro", 3, "CAS-M-NG"), variant("L", "Negro", 1, "CAS-L-NG")] });
  const gorro = await seed(rosa, { name: "Gorro", createdAt: new Date("2026-01-01"), options: [], variants: [{ stock: 8, sku: "GOR-1" }] });
  const bufanda = await seed(rosa, { name: "Bufanda", createdAt: new Date("2026-01-01"), variants: [variant("U", "Gris", 9, "BUF-1"), variant("U", "Rojo", 3, "BUF-2")] });
  const estampado = await seed(rosa, { name: "Polo estampado", createdAt: new Date("2026-10-25T15:00:00Z"), variants: [variant("M", "Azul", 6, "EST-1")] });
  await seed(rosa, { name: "Chompa", createdAt: new Date("2026-11-02T15:00:00Z"), variants: [variant("M", "Azul", 5, "CHO-1")] });
  await seed(rosa, { name: "Short", createdAt: new Date("2026-01-01"), variants: [variant("M", "Azul", 0, "SHO-1")] });
  await seed(rosa, { name: "Vestido", createdAt: new Date("2026-01-01"), variants: [variant("M", "Azul", 7, "VES-1", "inactive")] });
  [poloId, casacaId, gorroId, bufandaId, estampadoId] = [polo.productId, casaca.productId, gorro.productId, bufanda.productId, estampado.productId];
  const [poloM, poloL, poloS] = polo.variantIds as [string, string, string];
  const [casacaM, casacaL] = casaca.variantIds as [string, string];
  await sell(rosa, "2026-10-03T15:00:00Z", [{ variant: poloM, quantity: 3, unitPrice: 35 }], { charge: 15 });
  await sell(rosa, "2026-10-10T15:00:00Z", [{ variant: casacaM, quantity: 1, unitPrice: 120 }]);
  await sell(rosa, "2026-10-12T15:00:00Z", [{ variant: gorro.variantIds[0]!, quantity: 4, unitPrice: 25 }], { cancelled: true });
  await sell(rosa, "2026-10-20T15:00:00Z", [{ variant: poloL, quantity: 3, unitPrice: 35 }, { variant: casacaL, quantity: 1, unitPrice: 120 }], { charge: 15 });
  await sell(rosa, "2026-11-01T04:30:00Z", [{ variant: poloM, quantity: 2, unitPrice: 35 }, { variant: casacaM, quantity: 1, unitPrice: 120 }], { charge: 10 });
  await sell(rosa, "2026-10-15T15:00:00Z", [{ variant: poloS, quantity: 5, unitPrice: 35 }], { unconfirmedCatalog: true });
  await sell(rosa, "2026-08-14T15:00:00Z", [{ variant: bufanda.variantIds[0]!, quantity: 1, unitPrice: 20 }]);
  await sell(rosa, "2026-08-20T15:00:00Z", [{ variant: casacaM, quantity: 1, unitPrice: 120 }]);
  const luisProduct = await seed(luis, { name: "Polo de Luis", createdAt: new Date("2026-01-01"), variants: [variant("M", "Azul", 5, "LUIS-1")] });
  luisId = luisProduct.productId;
  await sell(luis, "2026-10-05T15:00:00Z", [{ variant: luisProduct.variantIds[0]!, quantity: 9, unitPrice: 50 }]);
});

afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
  vi.useRealTimers();
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await systemPrisma.$disconnect();
});

describe("lo_mas_vendido through the MCP server", () => {
  test("ranks the example store by units and by amount, never counting delivery, the cancelled order or the unconfirmed catalog order", async () => {
    const result = await call(rosa, "lo_mas_vendido", october);
    expect(result.isError).toBeFalsy();
    const output = result.structuredContent!;
    expect(output.hoy).toBe("Hoy es 05/11/2026");
    expect(output.resumen).toBe("Del 01/10/2026 al 31/10/2026: 11 unidades de 2 productos, S/ 640.00 en productos.");
    expect(output.productos.map((item) => [item.nombre, item.unidades, item.monto, item.participacion])).toEqual([
      ["Polo básico", 8, "S/ 280.00", "44% de tus ventas de productos del periodo"], ["Casaca", 3, "S/ 360.00", "56% de tus ventas de productos del periodo"],
    ]);
    expect(output.productos[0]).toMatchObject({ id: poloId, enlace: `${authIssuer}/products/${poloId}`, variantes: [
      { combinacion: "M / Azul", unidades: 5, monto: "S/ 175.00" }, { combinacion: "L / Negro", unidades: 3, monto: "S/ 105.00" }] });
    expect(output.productos[1]!.variantes).toEqual([{ combinacion: "M / Negro", unidades: 2, monto: "S/ 240.00" }, { combinacion: "L / Negro", unidades: 1, monto: "S/ 120.00" }]);
    const byAmount = (await call(rosa, "lo_mas_vendido", { ...october, orden: "monto" })).structuredContent!;
    expect(byAmount.productos.map((item) => item.nombre)).toEqual(["Casaca", "Polo básico"]);
    expect(JSON.stringify(output)).not.toContain("Gorro");
    expect(JSON.stringify(output)).not.toContain("Luis");
  });

  test("texto narrows the ranking but keeps the whole-period share, and a texto whose only order is cancelled answers the no-sales text", async () => {
    const polo = (await call(rosa, "lo_mas_vendido", { ...october, texto: "POLO" })).structuredContent!;
    expect(polo.resumen).toBe('Del 01/10/2026 al 31/10/2026, productos que coinciden con "POLO": 8 unidades de 1 producto, S/ 280.00 de los S/ 640.00 que vendiste en productos.');
    expect(polo.productos.map((item) => [item.nombre, item.participacion])).toEqual([["Polo básico", "44% de tus ventas de productos del periodo"]]);
    const gorro = (await call(rosa, "lo_mas_vendido", { ...october, texto: "gorro" })).structuredContent!;
    expect(gorro.mensaje).toBe('Ningún producto que coincida con "gorro" se vendió del 01/10/2026 al 31/10/2026.');
    expect(gorro.productos).toEqual([]);
    const sku = (await call(rosa, "lo_mas_vendido", { ...october, texto: "cas-m" })).structuredContent!;
    expect(sku.productos.map((item) => item.nombre)).toEqual(["Casaca"]);
  });

  test("a producto answers every variant sold with its header and the example agrees with the ranking", async () => {
    const one = (await call(rosa, "lo_mas_vendido", { ...october, producto: poloId, texto: "ignorado" })).structuredContent!;
    expect(one.resumen).toBe('"Polo básico" del 01/10/2026 al 31/10/2026: 8 unidades, S/ 280.00, 44% de tus ventas de productos del periodo (S/ 640.00).');
    expect(one.nota).toBe("Con producto se ignoran texto, orden y pagina.");
    expect(one.productos[0]!.variantes).toHaveLength(2);
    const gorro = (await call(rosa, "lo_mas_vendido", { ...october, producto: gorroId })).structuredContent!;
    expect(gorro.mensaje).toBe('"Gorro" no tuvo ventas del 01/10/2026 al 31/10/2026.');
  });

  test("a producto of another store and one that is not an identifier answer the not-found text, and a period with no sales answers its text", async () => {
    const message = "No encontré ese producto en tu tienda. Búscalo con Buscar productos.";
    for (const producto of [luisId, "no-es-un-id", randomUUID()]) {
      const result = await call(rosa, "lo_mas_vendido", { ...october, producto });
      expect(result.content[0]!.text).toContain(message);
    }
    const empty = (await call(rosa, "lo_mas_vendido", { desde: "2026-02-01", hasta: "2026-02-28" })).structuredContent!;
    expect(empty.mensaje).toBe("No vendiste productos del 01/02/2026 al 28/02/2026.");
    const luisRanking = (await call(luis, "lo_mas_vendido", october)).structuredContent!;
    expect(luisRanking.productos.map((item) => item.nombre)).toEqual(["Polo de Luis"]);
  });

  test("refuses invalid periods with their texts and reads nothing", async () => {
    const { result, statements } = await countSnapshotStatements(() => call(rosa, "lo_mas_vendido", { desde: "2025-09-01", hasta: "2026-10-05" }));
    expect(result.content[0]!.text).toContain("El periodo puede tener hasta 366 días. Pide uno más corto.");
    expect(statements).toEqual([]);
  });

  test("issues exactly the salesPathStatements count for the ranking and for a producto", async () => {
    const ranking = await countSnapshotStatements(() => call(rosa, "lo_mas_vendido", { ...october, texto: "polo" }));
    const product = await countSnapshotStatements(() => call(rosa, "lo_mas_vendido", { ...october, producto: casacaId }));
    expect(ranking.statements).toEqual([salesPathStatements.best_sellers]);
    expect(product.statements).toEqual([salesPathStatements.best_sellers]);
  });
});

describe("productos_sin_ventas through the MCP server", () => {
  test("lists Bufanda, Gorro and Polo estampado for October and omits Chompa, Short, Vestido and the products that sold", async () => {
    const result = await call(rosa, "productos_sin_ventas", october);
    expect(result.isError).toBeFalsy();
    const output = result.structuredContent!;
    expect(output.resumen).toBe("3 de tus 5 productos con stock no se vendieron del 01/10/2026 al 31/10/2026.");
    expect(output.productos.map((item) => [item.nombre, item.stock, item.fechas])).toEqual([
      ["Bufanda", "Stock: 12 · 1 con stock bajo", "Última venta antes del periodo: 14/08/2026"],
      ["Gorro", "Stock: 8", "Ninguna venta antes del periodo"],
      ["Polo estampado", "Stock: 6", "Ninguna venta antes del periodo · Creado el 25/10/2026"],
    ]);
    expect(output.productos.map((item) => item.id)).toEqual([bufandaId, gorroId, estampadoId]);
    expect(JSON.stringify(output)).not.toMatch(/Chompa|Short|Vestido|Luis/);
  });

  test("shows the last sale before and the first sale after a period that ended before today", async () => {
    const output = (await call(rosa, "productos_sin_ventas", { desde: "2026-09-01", hasta: "2026-09-30" })).structuredContent!;
    const casaca = output.productos.find((item) => item.nombre === "Casaca")!;
    expect(casaca.fechas).toBe("Última venta antes del periodo: 20/08/2026 · Volvió a venderse el 10/10/2026");
    expect(output.productos.map((item) => item.nombre)).not.toContain("Polo estampado");
  });

  test("answers its empty texts and the short-period line", async () => {
    expect((await call(rosa, "productos_sin_ventas", { ...october, texto: "zapato" })).structuredContent!.mensaje).toBe('Ningún producto coincide con "zapato".');
    expect((await call(rosa, "productos_sin_ventas", { desde: "2026-09-01", hasta: "2026-09-30", texto: "estampado" })).structuredContent!.mensaje)
      .toBe('Tus productos con stock que coinciden con "estampado" se crearon después del 30/09/2026: ninguno estaba a la venta en esas fechas.');
    expect((await call(rosa, "productos_sin_ventas", { ...october, texto: "short" })).structuredContent!.mensaje)
      .toBe('Ninguno de tus productos que coinciden con "short" tiene stock hoy, así que no hay productos parados que revisar.');
    expect((await call(rosa, "productos_sin_ventas", { ...october, texto: "casac" })).structuredContent!.mensaje).toBe('Tu único producto con stock que coincide con "casac" tuvo ventas del 01/10/2026 al 31/10/2026.');
    expect((await call(rosa, "productos_sin_ventas", { desde: "2026-11-01", hasta: "2026-11-03" })).structuredContent!.aviso)
      .toBe("Este periodo tiene solo 3 días: para ver lo que no rota, pide al menos un mes.");
  });

  test("another store's products never appear and issues exactly the salesPathStatements count", async () => {
    const mine = await countSnapshotStatements(() => call(rosa, "productos_sin_ventas", october));
    expect(mine.statements).toEqual([salesPathStatements.unsold]);
    const theirs = (await call(luis, "productos_sin_ventas", october)).structuredContent!;
    expect(theirs.mensaje).toBe('Tu único producto con stock tuvo ventas del 01/10/2026 al 31/10/2026.');
    expect(JSON.stringify(theirs)).not.toContain("Polo básico");
  });

  test("a store without products answers its text and reads no order", async () => {
    const empty: Store = { companyId: randomUUID(), userId: `empty-${suffix}`, connectionId: randomUUID() };
    await createStore(empty, "Tienda vacía");
    const { result, statements } = await countSnapshotStatements(() => call(empty, "productos_sin_ventas", october));
    expect(result.structuredContent!.mensaje).toBe("Tu tienda todavía no tiene productos.");
    expect(statements).toEqual([3]);
  });
});
