import { z } from "zod";
import { dateFormatMessage } from "@core/src/features/assistants/presentation/tools/orders-texts";

/** Input fields shared by the order, product and sales tools. */
export const day = z.string({ error: dateFormatMessage }).regex(/^\d{4}-\d{2}-\d{2}$/, dateFormatMessage).refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value), dateFormatMessage);
export const page = z.number({ error: "La página debe ser un número entero." }).int("La página debe ser un número entero.").min(1, "La página empieza en 1.").default(1);

// Zod words an unknown field in English; the agent gets Spanish, like every other text.
export const unknownField = { error: (issue: { code: string; keys?: string[] }) => issue.code === "unrecognized_keys" ? `No existe el campo ${(issue.keys ?? []).join(", ")}. Usa solo los campos de la herramienta.` : undefined };
