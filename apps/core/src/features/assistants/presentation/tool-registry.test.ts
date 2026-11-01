import { describe, expect, test } from "vitest";
import { z } from "zod";
import { ok } from "@shared/functional";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { CompanyId, UserId } from "@shared/identity";
import type { AssistantConnectionId } from "@core/src/features/assistants/domain/assistant-connection";
import type { AssistantAccess } from "@core/src/features/assistants/application/resolve-assistant-access";
import { checkToolModules, createToolRegistry } from "@core/src/features/assistants/presentation/tool-registry";
import type { RegisteredTool, ToolModule } from "@core/src/features/assistants/presentation/tool-module";

type Output = { total: number };

function fixtureTool(overrides: Partial<RegisteredTool<Record<string, never>, Output>> = {}): RegisteredTool<Record<string, never>, Output> {
  return {
    name: "buscar_de_prueba", title: "Buscar de prueba", description: "Busca registros de prueba y devuelve su total.",
    inputSchema: z.strictObject({}), outputSchema: z.strictObject({ total: z.number() }),
    sampleOutputs: [{ total: 1 }],
    run: async () => ok({ output: { total: 1 }, empty: false }),
    ...overrides,
  };
}

const moduleWith = (instructions: string, tool = fixtureTool()): ToolModule =>
  ({ scopes: ["orders:read"], access: "read", instructions, readFailureMessage: "No pudimos leer los datos de prueba.", tools: [tool] });

describe("checkToolModules language rule", () => {
  test("accepts a module that leaves the language to the general instructions", () => {
    expect(checkToolModules([moduleWith("Las herramientas de prueba solo leen.")])).toEqual([]);
  });

  test("reports a module whose instructions say to answer in Spanish", () => {
    expect(checkToolModules([moduleWith("Responde siempre en español.")]).join(" ")).toContain("en español");
    expect(checkToolModules([moduleWith("Responde EN ESPANOL siempre.")]).length).toBe(1);
  });

  test("reports a description that says to quote a reason «tal cual»", () => {
    const tool = fixtureTool({ description: "Busca registros y responde en Español con el motivo." });
    expect(checkToolModules([moduleWith("Solo lee.", tool)]).join(" ")).toContain("en español");
    expect(checkToolModules([moduleWith("Cítalo tal cual.")]).join(" ")).toContain("tal cual");
    const quoting = fixtureTool({ description: "Devuelve el motivo; repítelo TAL CUAL al dueño." });
    expect(checkToolModules([moduleWith("Solo lee.", quoting)]).join(" ")).toContain("tal cual");
  });

  test("reports a title that says to answer in Spanish", () => {
    const tool = fixtureTool({ title: "Buscar en español" });
    expect(checkToolModules([moduleWith("Solo lee.", tool)]).join(" ")).toContain("en español");
  });
});

describe("the reading-failure text of each module", () => {
  const access: AssistantAccess = {
    companyId: "6c0f5d2e-6a63-4a38-9f07-3b8f7a1c0002" as CompanyId, userId: "user-1" as UserId,
    connectionId: "6c0f5d2e-6a63-4a38-9f07-3b8f7a1c0001" as AssistantConnectionId, scopes: ["orders:read", "products:read"], lastUsedAt: null,
  };
  const orders = { ...moduleWith("Pedidos.", fixtureTool({ name: "buscar_pedidos_prueba", title: "Pedidos de prueba" })), readFailureMessage: "No pudimos leer tus pedidos en este momento." };
  const products: ToolModule = {
    scopes: ["products:read"], access: "read", instructions: "Productos.", readFailureMessage: "No pudimos leer tus productos en este momento.",
    tools: [fixtureTool({ name: "buscar_productos_prueba", title: "Productos de prueba", run: async () => { throw new Error("boom"); } })],
  };
  const ordersBroken: ToolModule = {
    ...orders, tools: [fixtureTool({ name: "buscar_pedidos_prueba", title: "Pedidos de prueba", run: async () => ok({ output: { total: "uno" } as never, empty: false }) })],
  };

  async function call(modules: readonly ToolModule[], name: string) {
    const server = createToolRegistry({
      modules, toolCallLimit: 60, now: () => 0,
      answer: { allowCall: () => ({ allowed: true }), touchConnection: async () => ok(null), clock: () => new Date("2026-10-30T12:00:00Z") },
    }).createServer(access);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1.0.0" });
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    const result = await client.callTool({ name, arguments: {} });
    await client.close();
    await server.close();
    return result;
  }

  test("answers a product tool's thrown read with the products reading-failure text", async () => {
    const result = await call([ordersBroken, products], "buscar_productos_prueba");
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: "No pudimos leer tus productos en este momento." }]);
  });

  test("answers an order tool's invalid output with the orders reading-failure text", async () => {
    const result = await call([ordersBroken, products], "buscar_pedidos_prueba");
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: "No pudimos leer tus pedidos en este momento." }]);
  });

  test("reports a module whose reading-failure text is empty", () => {
    expect(checkToolModules([{ ...orders, readFailureMessage: "  " }]).join(" ")).toContain("reading-failure message");
  });
});

describe("a module that requires several scopes", () => {
  const holding = (scopes: AssistantAccess["scopes"]): AssistantAccess => ({
    companyId: "6c0f5d2e-6a63-4a38-9f07-3b8f7a1c0002" as CompanyId, userId: "user-1" as UserId,
    connectionId: "6c0f5d2e-6a63-4a38-9f07-3b8f7a1c0001" as AssistantConnectionId, scopes, lastUsedAt: null,
  });
  const orders = moduleWith("Pedidos.", fixtureTool({ name: "buscar_pedidos_prueba", title: "Pedidos de prueba" }));
  const sales: ToolModule = {
    scopes: ["orders:read", "products:read"], access: "read", instructions: "Ventas de prueba.", readFailureMessage: "No pudimos leer tus ventas en este momento.",
    tools: [fixtureTool({ name: "resumen_de_prueba", title: "Resumen de prueba" })],
  };

  async function listed(scopes: AssistantAccess["scopes"]) {
    const server = createToolRegistry({
      modules: [orders, sales], toolCallLimit: 60, now: () => 0,
      answer: { allowCall: () => ({ allowed: true }), touchConnection: async () => ok(null), clock: () => new Date("2026-10-30T12:00:00Z") },
    }).createServer(holding(scopes));
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1.0.0" });
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    const instructions = client.getInstructions() ?? "";
    await client.close();
    await server.close();
    return { names, instructions };
  }

  test("offers a module that requires orders and products only to a connection holding both scopes", async () => {
    const both = await listed(["orders:read", "products:read"]);
    expect(both.names).toEqual(["buscar_pedidos_prueba", "resumen_de_prueba"]);
    expect(both.instructions).toContain("Ventas de prueba.");
    expect((await listed(["products:read"])).names).toEqual([]);
  });

  test("a connection with only the orders scope sees neither the sales tools nor their instructions paragraph", async () => {
    const only = await listed(["orders:read"]);
    expect(only.names).toEqual(["buscar_pedidos_prueba"]);
    expect(only.instructions).toContain("Pedidos.");
    expect(only.instructions).not.toContain("Ventas de prueba.");
  });

  test("refuses a module that repeats a scope", () => {
    const repeated: ToolModule = { ...sales, scopes: ["orders:read", "orders:read"] };
    expect(checkToolModules([repeated]).join(" ")).toContain("orders:read+orders:read repeats a scope");
    expect(checkToolModules([sales])).toEqual([]);
  });
});
