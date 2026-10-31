import { describe, expect, test } from "vitest";
import { z } from "zod";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { ok } from "@shared/functional";
import type { CompanyId, UserId } from "@shared/identity";
import type { AssistantConnectionId } from "@core/src/features/assistants/domain/assistant-connection";
import type { AssistantAccess } from "@core/src/features/assistants/application/resolve-assistant-access";
import { checkToolModules, createToolRegistry, maxToolOutputBytes } from "@core/src/features/assistants/presentation/tool-registry";
import type { RegisteredTool, ToolModule } from "@core/src/features/assistants/presentation/tool-module";
import { toolModules } from "@core/src/composition/assistant-tools";

type Input = { texto?: string };
type Output = { total: number; pedidos: string[] };

const outputSchema = z.strictObject({ total: z.number(), pedidos: z.array(z.string().max(2000)).max(100) });

function fixtureTool(overrides: Partial<RegisteredTool<Input, Output>> = {}): RegisteredTool<Input, Output> {
  return {
    name: "buscar_de_prueba", title: "Buscar de prueba", description: "Busca registros de prueba y devuelve su total.",
    inputSchema: z.strictObject({ texto: z.string().max(120).optional() }), outputSchema,
    sampleOutputs: [{ total: 1, pedidos: ["#1001"] }],
    run: async (input) => ok({ output: { total: 1, pedidos: [input.texto ?? "#1001"] }, empty: false }),
    ...overrides,
  };
}

function fixtureModule(tools: readonly RegisteredTool<Input, Output>[] = [fixtureTool()], overrides: Partial<ToolModule> = {}): ToolModule {
  return { scopes: ["orders:read"], access: "read", instructions: "Las herramientas de prueba solo leen.", readFailureMessage: "No pudimos leer los datos de prueba.", tools, ...overrides };
}

const access: AssistantAccess = {
  companyId: "6c0f5d2e-6a63-4a38-9f07-3b8f7a1c0002" as CompanyId, userId: "user-1" as UserId,
  connectionId: "6c0f5d2e-6a63-4a38-9f07-3b8f7a1c0001" as AssistantConnectionId, scopes: ["orders:read"], lastUsedAt: null,
};

function registryFor(modules: readonly ToolModule[]) {
  return createToolRegistry({
    modules, toolCallLimit: 60, now: () => 0,
    answer: { allowCall: () => ({ allowed: true }), touchConnection: async () => ok(null), clock: () => new Date("2026-10-30T12:00:00Z") },
  });
}

async function connect(modules: readonly ToolModule[], connectionAccess: AssistantAccess = access) {
  const server = registryFor(modules).createServer(connectionAccess);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "validator", version: "1.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

describe("the registered tool modules", () => {
  test("follow every rule of the registry", () => {
    expect(checkToolModules(toolModules)).toEqual([]);
  });

  test("list exactly the four order tools, all read only, for a connection with the orders scope", async () => {
    const { client, close } = await connect(toolModules);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["buscar_pedidos", "ver_pedido", "pedidos_por_cobrar", "pedidos_por_despachar_hoy"]);
    expect(client.getInstructions()).toContain("solo lee");
    await close();
  });

  test("lists the six tools, all read only, for a connection with both scopes", async () => {
    const { client, close } = await connect(toolModules, { ...access, scopes: ["orders:read", "products:read"] });
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["buscar_pedidos", "ver_pedido", "pedidos_por_cobrar", "pedidos_por_despachar_hoy", "buscar_productos", "ver_producto"]);
    for (const tool of tools) expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    expect(client.getInstructions()).toContain("productos");
    await close();
  });

  test("a connection with only the products scope lists the two product tools", async () => {
    const { client, close } = await connect(toolModules, { ...access, scopes: ["products:read"] });
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(["buscar_productos", "ver_producto"]);
    await close();
  });

  test("a connection without the orders scope lists no order tools", async () => {
    const { client, close } = await connect(toolModules, { ...access, scopes: [] });
    expect((await client.listTools()).tools).toEqual([]);
    await close();
  });

  test("a twenty-order page with maximum-length texts stays under 24 KB", () => {
    for (const name of ["buscar_pedidos", "pedidos_por_cobrar", "pedidos_por_despachar_hoy"]) {
      const tool = toolModules.flatMap((module) => module.tools).find((candidate) => candidate.name === name)!;
      expect(tool.sampleOutputs[0].pedidos).toHaveLength(20);
      expect(Buffer.byteLength(JSON.stringify(tool.sampleOutputs[0]))).toBeLessThan(maxToolOutputBytes);
    }
  });

  test("an order with sixty maximum-length item lines and ten payments stays under 24 KB", () => {
    const tool = toolModules.flatMap((module) => module.tools).find((candidate) => candidate.name === "ver_pedido")!;
    const sample = tool.sampleOutputs[0];
    expect(sample.productos).toHaveLength(60);
    expect(sample.pagos).toHaveLength(10);
    expect(Buffer.byteLength(JSON.stringify(sample))).toBeLessThan(maxToolOutputBytes);
  });
});

describe("the product tools' response budget", () => {
  const sampleOf = (name: string, index: number) => toolModules.flatMap((module) => module.tools).find((candidate) => candidate.name === name)!.sampleOutputs[index];

  test("keeps a search page of 20 products at maximum ASCII lengths within 24 KB", () => {
    const sample = sampleOf("buscar_productos", 0);
    expect(sample.productos).toHaveLength(20);
    expect(Buffer.byteLength(JSON.stringify(sample))).toBeLessThan(maxToolOutputBytes);
  });

  test("keeps a search page of 20 products with 3 matching variants each at maximum ASCII lengths within 24 KB", () => {
    const sample = sampleOf("buscar_productos", 1);
    expect(sample.productos).toHaveLength(20);
    expect(sample.productos.every((product: { variantes_coincidentes?: unknown[] }) => product.variantes_coincidentes?.length === 3)).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(sample))).toBeLessThan(maxToolOutputBytes);
  });

  test("keeps a product of 60 variants with a 1,000-character description at maximum ASCII lengths within 24 KB", () => {
    const sample = sampleOf("ver_producto", 0);
    expect(sample.variantes).toHaveLength(60);
    expect(sample.descripcion.length).toBeGreaterThan(1000);
    expect(Buffer.byteLength(JSON.stringify(sample))).toBeLessThan(maxToolOutputBytes);
  });

  test("answers a product of 100 variants at maximum lengths complete", async () => {
    const full = sampleOf("ver_producto", 0);
    const huge = { ...full, variantes: Array.from({ length: 100 }, (_, index) => ({ ...full.variantes[0], sku: `${index}`.padEnd(100, "S") })) };
    expect(Buffer.byteLength(JSON.stringify(huge))).toBeGreaterThan(maxToolOutputBytes);
    const module = fixtureModule([fixtureTool({
      name: "ver_producto_de_prueba", title: "Ver producto de prueba", outputSchema: z.looseObject({ variantes: z.array(z.unknown()) }) as never,
      sampleOutputs: [{ variantes: [] } as never], run: async () => ok({ output: huge as never, empty: false }),
    })]);
    const { client, close } = await connect([module]);
    const result = await client.callTool({ name: "ver_producto_de_prueba", arguments: {} });
    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { variantes: unknown[] }).variantes).toHaveLength(100);
    await close();
  });
});

describe("static validator", () => {
  test("every tool has an ASCII name, a Spanish title and a description", () => {
    expect(checkToolModules([fixtureModule()])).toEqual([]);
    expect(checkToolModules([fixtureModule([fixtureTool({ name: "Buscar" })])]).join(" ")).toContain("Invalid tool name");
    expect(checkToolModules([fixtureModule([fixtureTool({ name: "búsqueda" })])]).join(" ")).toContain("Invalid tool name");
    expect(checkToolModules([fixtureModule([fixtureTool({ title: "buscar_de_prueba" })])]).join(" ")).toContain("Spanish display title");
    expect(checkToolModules([fixtureModule([fixtureTool({ description: "corta" })])]).join(" ")).toContain("needs a description");
  });

  test("every input schema is a valid strict JSON Schema object", async () => {
    const { client, close } = await connect([fixtureModule()]);
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].inputSchema).toMatchObject({ type: "object", additionalProperties: false, properties: { texto: { type: "string", maxLength: 120 } } });
    await close();
    const loose = fixtureTool({ inputSchema: z.object({ texto: z.string().optional() }).passthrough() as never });
    expect(checkToolModules([fixtureModule([loose])]).join(" ")).toContain("strict JSON Schema object");
  });

  test("every tool's annotations are the ones derived from its read module", async () => {
    const { client, close } = await connect([fixtureModule()]);
    const { tools } = await client.listTools();
    expect(tools[0].annotations).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    await close();
  });

  test("refuses a module that is not declared read", () => {
    const write = fixtureModule([fixtureTool()], { access: "write" as never });
    expect(checkToolModules([write]).join(" ")).toContain("is not declared read");
    expect(() => registryFor([write])).toThrow("Unsupported tool module access");
  });

  test("no tool name or title names a write action", () => {
    expect(checkToolModules([fixtureModule([fixtureTool({ name: "crear_pedido", title: "Registrar pedido" })])]).join(" ")).toContain("write action");
    expect(checkToolModules([fixtureModule([fixtureTool({ name: "ver_pedido", title: "Cancelar pedido" })])]).join(" ")).toContain("write action");
    expect(checkToolModules([fixtureModule([fixtureTool({ name: "pedidos_por_despachar_hoy", title: "Pedidos por despachar hoy" })])])).toEqual([]);
  });

  test("every sample output validates against its output schema", () => {
    const bad = fixtureTool({ sampleOutputs: [{ total: "uno" } as never] });
    expect(checkToolModules([fixtureModule([bad])]).join(" ")).toContain("does not validate against its output schema");
    expect(checkToolModules([fixtureModule([fixtureTool({ sampleOutputs: [] })])]).join(" ")).toContain("at least one sample output");
  });

  test("no sample output contains the fixture phone, street or document", () => {
    for (const secret of ["987654789", "Av. Larco 123", "45678912"]) {
      const leaking = fixtureTool({ sampleOutputs: [{ total: 1, pedidos: [`Cliente ${secret}`] }] });
      expect(checkToolModules([fixtureModule([leaking])]).join(" ")).toContain(secret);
    }
  });

  test("a sample output of maximum length stays under 24 KB and one over it is a violation", () => {
    const limit = (items: number) => fixtureTool({ sampleOutputs: [{ total: items, pedidos: Array.from({ length: items }, () => "x".repeat(1000)) }] });
    expect(checkToolModules([fixtureModule([limit(20)])])).toEqual([]);
    expect(Buffer.byteLength(JSON.stringify(limit(20).sampleOutputs[0]))).toBeLessThan(maxToolOutputBytes);
    expect(checkToolModules([fixtureModule([limit(25)])]).join(" ")).toContain("over 24 KB");
  });

  test("refuses two tools with the same name", () => {
    expect(checkToolModules([fixtureModule(), fixtureModule()]).join(" ")).toContain("Repeated tool name");
  });

  test("a connection without the orders scope lists no order tools", async () => {
    const { client, close } = await connect([fixtureModule()], { ...access, scopes: [] });
    expect((await client.listTools()).tools).toEqual([]);
    await close();
  });

  test("rejects a fixture module that breaks any of these rules", () => {
    const broken = fixtureModule([fixtureTool({ name: "BORRAR", title: "x", description: "", sampleOutputs: [] })], { access: "write" as never });
    expect(checkToolModules([broken]).length).toBeGreaterThanOrEqual(2);
  });
});

describe("the server built by the registry", () => {
  test("serves a call with structured content and the same JSON as text", async () => {
    const { client, close } = await connect([fixtureModule()]);
    const result = await client.callTool({ name: "buscar_de_prueba", arguments: { texto: "#1002" } });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ total: 1, pedidos: ["#1002"] });
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify({ total: 1, pedidos: ["#1002"] }) }]);
    await close();
  });

  test("answers invalid input as a tool error and carries the server instructions", async () => {
    const { client, close } = await connect([fixtureModule()]);
    const result = await client.callTool({ name: "buscar_de_prueba", arguments: { texto: "x".repeat(121) } });
    expect(result.isError).toBe(true);
    // v1 SDK clients validate structuredContent against the output schema even on errors, so an error result carries none.
    expect(result.structuredContent).toBeUndefined();
    expect(JSON.stringify(result.content)).toContain("texto");
    expect(client.getInstructions()).toContain("Las herramientas de prueba solo leen.");
    await close();
  });

  test("never sends an output that breaks its strict schema", async () => {
    const leaking = fixtureTool({ run: async () => ok({ output: { total: 1, pedidos: [], telefono: "987654789" } as never, empty: false }) });
    const { client, close } = await connect([fixtureModule([leaking])]);
    const result = await client.callTool({ name: "buscar_de_prueba", arguments: {} });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain("987654789");
    await close();
  });
});
