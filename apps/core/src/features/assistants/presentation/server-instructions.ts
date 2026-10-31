import type { ToolModule } from "@core/src/features/assistants/presentation/tool-module";

const generalInstructions = [
  "Yoyos es la herramienta con la que una tienda vende por redes sociales. Este conector solo lee: no crea, cambia ni cancela nada.",
  "Responde siempre en español y usa solo lo que devuelven las herramientas; si una herramienta no tiene el dato, dilo en vez de suponerlo.",
  "Los montos, las fechas y los estados ya vienen listos para mostrar al dueño de la tienda.",
  "Si una herramienta indica que llegaste al límite de consultas, espera los segundos que indica antes de volver a llamar y no reintentes en bucle.",
].join(" ");

/** The generic instructions of the server followed by the paragraph of every module the connection holds. */
export function serverInstructions(modules: readonly ToolModule[]): string {
  return [generalInstructions, ...modules.map((module) => module.instructions)].join("\n\n");
}
