import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { signJWT } from "better-auth/plugins";
import { auth, authIssuer, mcpResourceUrl } from "@core/src/shared/infrastructure/auth";
import { prisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { assistantConfig } from "@core/src/features/assistants/infrastructure/assistant-config";
import { limitMessage } from "@core/src/features/assistants/presentation/tool-registry";
import { createAssistantMcpRoutes } from "@core/src/composition/assistant-server";
import { toolModules } from "@core/src/composition/assistant-tools";
import { createSalesStore, seedOctoberExample, type SalesStore } from "../../tests/support/sales-summary-seed";

const suffix = randomUUID();
const clientId = `sales-tools-client-${suffix}`;
const stores: SalesStore[] = [];
const servers: Server[] = [];
let base: string;
let rosa: SalesStore;
let limited: SalesStore;

const nineTools = [
  "buscar_pedidos", "ver_pedido", "pedidos_por_cobrar", "pedidos_por_despachar_hoy", "buscar_productos", "ver_producto",
  "resumen_de_ventas", "lo_mas_vendido", "productos_sin_ventas",
];
const october = { desde: "2026-10-01", hasta: "2026-10-31" };

type Rpc = { result?: { isError?: boolean; structuredContent?: Record<string, unknown>; content?: { text: string }[]; tools?: { name: string; annotations?: unknown }[]; _meta?: { retryAfterSeconds?: number } } };

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

async function rpc(store: SalesStore, method: string, params: unknown = {}): Promise<NonNullable<Rpc["result"]>> {
  const response = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18", authorization: `Bearer ${await mint(store.sellerId)}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const text = await response.text();
  const data = response.headers.get("content-type")?.includes("text/event-stream") ? text.split("\n").find((line) => line.startsWith("data:"))?.slice(5) ?? "" : text;
  const body = JSON.parse(data) as Rpc;
  if (!body.result) throw new Error(`${response.status} ${data}`);
  return body.result;
}

const callTool = (store: SalesStore, name: string, args: unknown = {}) => rpc(store, "tools/call", { name, arguments: args });

// A connection authorized before this release: it holds the two scopes that already existed and no other.
async function connect(name: string): Promise<SalesStore> {
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

beforeAll(async () => {
  expect(process.env.DATABASE_URL, "run sh scripts/run-tests.sh integration").toBeTruthy();
  // The example store is asked on 05/11/2026; only the clock is faked, the connections stay real.
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-05T15:00:00Z") });
  base = await serve();
  rosa = await connect("Tienda Rosa");
  limited = await connect("Tienda con límite");
  await seedOctoberExample(rosa);
  // The faked clock stamps the product on 05/11/2026; it must exist before October for the tool to check it.
  await withTenantIsolation(rosa.companyId, async () => { await prisma.product.updateMany({ data: { createdAt: new Date("2026-09-01T15:00:00Z") } }); });
});

afterAll(async () => {
  vi.useRealTimers();
  for (const store of stores) await store.dispose();
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("the nine assistant tools through the MCP server", () => {
  test("a connection lists nine tools and calls resumen_de_ventas, lo_mas_vendido and productos_sin_ventas on the example store", async () => {
    const listed = await rpc(rosa, "tools/list");
    expect(listed.tools!.map((tool) => tool.name)).toEqual(nineTools);

    const summary = await callTool(rosa, "resumen_de_ventas", october);
    expect(summary.isError).toBeFalsy();
    expect(summary.structuredContent).toMatchObject({ hoy: "Hoy es 05/11/2026", periodo: "Del 01/10/2026 al 31/10/2026" });

    const ranking = await callTool(rosa, "lo_mas_vendido", october);
    expect(ranking.isError).toBeFalsy();
    expect(ranking.structuredContent).toMatchObject({ hoy: "Hoy es 05/11/2026", total: 1 });

    const unsold = await callTool(rosa, "productos_sin_ventas", october);
    expect(unsold.isError).toBeFalsy();
    expect(unsold.structuredContent).toMatchObject({
      hoy: "Hoy es 05/11/2026", total: 0, mensaje: "Tu único producto con stock tuvo ventas del 01/10/2026 al 31/10/2026.",
    });
  });

  test("the summary's productos and the best sellers' header agree on the example store", async () => {
    const summary = await callTool(rosa, "resumen_de_ventas", october);
    const blocks = summary.structuredContent!.bloques as { ventas: string }[];
    expect(blocks[0]!.ventas).toContain("productos S/ 640.00");
    const ranking = await callTool(rosa, "lo_mas_vendido", october);
    expect(ranking.structuredContent!.resumen).toContain("S/ 640.00 en productos");
  });

  test("an existing connection keeps working and sees the nine tools without a new scope", async () => {
    const listed = await rpc(rosa, "tools/list");
    expect(listed.tools!.map((tool) => tool.name)).toEqual(nineTools);
    for (const tool of listed.tools!) expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    const connection = await withTenantIsolation(rosa.companyId, async () => await prisma.assistantConnection.findFirstOrThrow());
    expect(connection.scopes).toEqual(["orders:read", "products:read"]);
    // A tool it already used still answers (the minimal seeded orders carry no buyer data, so the order readers are not used here).
    expect((await callTool(rosa, "buscar_productos", { texto: "polo" })).isError).toBeFalsy();
  });

  test("a call over the store limit answers the limit text with the seconds", async () => {
    // Invalid input is refused after the limit is counted, so the limit is reached without reading.
    for (let index = 0; index < assistantConfig.toolCallLimitPerMinute; index += 1) await callTool(limited, "resumen_de_ventas", { desde: "01/10/2026" });
    for (const name of ["resumen_de_ventas", "lo_mas_vendido", "productos_sin_ventas"]) {
      const over = await callTool(limited, name, october);
      expect(over.isError).toBe(true);
      expect(over.content![0]!.text).toMatch(/^Llegaste al límite de \d+ consultas por minuto de tu tienda\. No reintentes antes de \d+ segundos\.$/);
      expect(over.content![0]!.text).toBe(limitMessage(assistantConfig.toolCallLimitPerMinute, over._meta!.retryAfterSeconds!));
      expect(over._meta?.retryAfterSeconds).toBeGreaterThan(0);
    }
  });
});
