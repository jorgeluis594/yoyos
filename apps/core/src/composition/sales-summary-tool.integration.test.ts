import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { signJWT } from "better-auth/plugins";
import { auth, authIssuer, mcpResourceUrl } from "@core/src/shared/infrastructure/auth";
import { prisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { createAssistantMcpRoutes } from "@core/src/composition/assistant-server";
import { toolModules } from "@core/src/composition/assistant-tools";
import { salesPathStatements } from "@core/src/features/orders/infrastructure/sales-read";
import { createSalesStore, lima, seedOctoberExample, type SalesStore } from "../../tests/support/sales-summary-seed";

const suffix = randomUUID();
const clientId = `sales-summary-client-${suffix}`;
const stores: SalesStore[] = [];
const servers: Server[] = [];
let base: string;
let rosa: SalesStore;
let vacio: SalesStore;
let otra: SalesStore;

type Block = Record<string, unknown> & { moneda: string };
type Output = { hoy: string; periodo?: string; significado?: string; mensaje?: string; bloques: Block[]; pagos_por_revisar?: string; cancelados?: string[] };
type ToolResult = { isError?: boolean; structuredContent?: Output; content: { text: string }[] };

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

async function call(store: SalesStore, args: unknown = {}): Promise<ToolResult> {
  const response = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18", authorization: `Bearer ${await mint(store.sellerId)}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "resumen_de_ventas", arguments: args } }),
  });
  const text = await response.text();
  const data = response.headers.get("content-type")?.includes("text/event-stream") ? text.split("\n").find((line) => line.startsWith("data:"))?.slice(5) ?? "" : text;
  const body = JSON.parse(data);
  if (!body.result) throw new Error(`${response.status} ${data}`);
  return body.result;
}

async function newStore(name: string): Promise<SalesStore> {
  const store = await createSalesStore(name);
  stores.push(store);
  await withTenantIsolation(store.companyId, async () => {
    await prisma.assistantConnection.create({ data: {
      id: randomUUID(), authorizedByUserId: store.sellerId, oauthClientId: clientId, agentName: "Claude", returnKind: "web", returnDomain: "claude.ai",
      scopes: ["orders:read", "products:read"], authorizedAt: new Date("2026-10-01T00:00:00Z"),
    } });
  });
  return store;
}

// Statements of the sales snapshot: from its repeatable-read transaction to the commit, without BEGIN, SET TRANSACTION and COMMIT (section 2 of the design).
async function countedStatements(work: () => Promise<unknown>): Promise<string[]> {
  const pg = await import("pg");
  const original = pg.Client.prototype.query;
  const log: string[] = [];
  const spy = vi.spyOn(pg.Client.prototype, "query").mockImplementation(function (this: unknown, ...args: unknown[]) {
    const first = args[0];
    log.push(typeof first === "string" ? first : (first as { text?: string } | undefined)?.text ?? "");
    return (original as (...rest: unknown[]) => unknown).apply(this, args);
  } as never);
  try { await work(); } finally { spy.mockRestore(); }
  const start = log.findIndex((text) => /REPEATABLE READ/i.test(text));
  const end = log.findIndex((text, index) => index > start && /^\s*COMMIT/i.test(text));
  return log.slice(start + 1, end).filter((text) => !/^\s*(BEGIN|COMMIT|ROLLBACK|SET TRANSACTION)/i.test(text));
}

beforeAll(async () => {
  expect(process.env.DATABASE_URL, "run sh scripts/run-tests.sh integration").toBeTruthy();
  // The example store is asked on 05/11/2026; only the clock is faked, the connections stay real.
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-05T15:00:00Z") });
  base = await serve();
  rosa = await newStore("Tienda Rosa");
  vacio = await newStore("Tienda vacía");
  otra = await newStore("Otra tienda");
  await seedOctoberExample(rosa);
  await otra.sell({ number: 1001, createdAt: lima("2026-10-05T10:00"), items: 999 });
});

afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
  vi.useRealTimers();
  for (const store of stores) await store.dispose();
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("resumen_de_ventas through the MCP server", () => {
  test("answers the example store and issues exactly the salesPathStatements count for the worst case of the path", async () => {
    let result: ToolResult | undefined;
    const statements = await countedStatements(async () => { result = await call(rosa, { desde: "2026-10-01", hasta: "2026-10-31" }); });
    expect(statements).toHaveLength(salesPathStatements.summary);
    expect(result!.isError).toBeFalsy();
    const output = result!.structuredContent!;
    expect(output).toMatchObject({
      hoy: "Hoy es 05/11/2026", periodo: "Del 01/10/2026 al 31/10/2026",
      pagos_por_revisar: "1 pago reportado por revisar, en 1 pedido. Se aprueba o rechaza en Yoyos.",
    });
    expect(output.bloques).toHaveLength(1);
    expect(output.bloques[0]).toMatchObject({
      moneda: "PEN", ventas: "S/ 680.00 (productos S/ 640.00, envíos S/ 40.00)", pedidos: 4, ticket_promedio: "S/ 170.00", recibido: "S/ 380.00",
      por_medio_de_pago: ["Yape: S/ 330.00 (87%)", "Plin: S/ 50.00 (13%)"], por_cobrar_de_estas_ventas: "S/ 310.00", exceso_recibido: "S/ 10.00",
      cancelados: ["1 pedido cancelado (S/ 100.00) no cuenta en las ventas.", "En pedidos cancelados hay S/ 40.00 en pagos confirmados. Si devolviste ese dinero, anula esos pagos en Yoyos desde la web."],
      comparacion: { encabezado: "Sin ventas en el periodo anterior (del 01/09/2026 al 30/09/2026).", lineas: [] },
    });
    expect(output.bloques[0]).not.toHaveProperty("periodo_abierto");
  });

  test("reads the current month in Lima by default and never another store's orders", async () => {
    const november = (await call(rosa)).structuredContent!;
    expect(november).toMatchObject({ periodo: "Del 01/11/2026 al 05/11/2026", mensaje: "No hay ventas del 01/11/2026 al 05/11/2026." });
    expect(JSON.stringify(november)).not.toContain("999");
    const mine = (await call(otra, { desde: "2026-10-01", hasta: "2026-10-31" })).structuredContent!;
    expect(mine.bloques[0]).toMatchObject({ pedidos: 1, ventas: "S/ 999.00 (productos S/ 999.00, envíos S/ 0.00)" });
  });

  test("answers a store without orders, a refused period and an invalid field with their texts", async () => {
    expect((await call(vacio)).structuredContent).toMatchObject({ hoy: "Hoy es 05/11/2026", mensaje: "Tu tienda todavía no tiene pedidos.", bloques: [] });
    const refused = await call(rosa, { hasta: "2026-10-31" });
    expect(refused.isError).toBe(true);
    expect(refused.content[0]!.text).toBe("Indica también la fecha inicial (desde).");
    const long = await call(rosa, { desde: "2025-09-01", hasta: "2026-10-31" });
    expect(long.content[0]!.text).toBe("El periodo puede tener hasta 366 días. Pide uno más corto.");
    const bad = await call(rosa, { desde: "01/10/2026" });
    expect(bad.isError).toBe(true);
  });
});
