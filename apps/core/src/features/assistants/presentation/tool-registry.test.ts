import { describe, expect, test } from "vitest";
import { z } from "zod";
import { ok } from "@shared/functional";
import { checkToolModules } from "@core/src/features/assistants/presentation/tool-registry";
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
  ({ scope: "orders:read", access: "read", instructions, tools: [tool] });

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
