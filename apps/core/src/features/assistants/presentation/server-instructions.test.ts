import { describe, expect, test } from "vitest";
import { serverInstructions } from "@core/src/features/assistants/presentation/server-instructions";
import type { ToolModule } from "@core/src/features/assistants/presentation/tool-module";

const normalized = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

describe("serverInstructions", () => {
  test("tells the agent to answer in the owner's language and to keep store data unchanged", () => {
    const text = serverInstructions([]);
    expect(normalized(text)).not.toContain("en espanol");
    expect(text).toContain("en el idioma en que te escriba el dueño");
    expect(text).toContain("Los textos de las herramientas vienen escritos siempre en un solo idioma (español): tradúcelos al idioma del dueño");
    expect(text).toMatch(/nombres de productos, combinaciones, valores, SKU, enlaces, montos, fechas y números de pedido.*sin cambiarlos/);
  });

  test("appends the paragraph of every module after the general instructions", () => {
    const module = { instructions: "Párrafo del módulo." } as ToolModule;
    expect(serverInstructions([module]).endsWith("\n\nPárrafo del módulo.")).toBe(true);
  });
});
