import type { PeriodRefusal } from "@core/src/features/assistants/domain/sales-period";
import { reversedRangeMessage } from "@core/src/features/assistants/presentation/tools/orders-texts";

export const salesReadFailureMessage = "No pudimos leer tus ventas en este momento. Inténtalo de nuevo en unos segundos.";
export const tooManyOrdersMessage = "Este periodo tiene demasiados pedidos para leerlo de una vez. Pide uno más corto, por ejemplo un mes.";

/** The paragraph of the sales group: only what spans the three tools; the rest lives once in the description of the tool it concerns. */
export const salesToolsInstructions = [
  "Para totales de ventas, lo más vendido y los productos que no se venden usa resumen_de_ventas, lo_mas_vendido y productos_sin_ventas; nunca sumes páginas de pedidos.",
  "«Ventas» son los pedidos registrados, pagados o no; «Recibido» es lo que esas ventas han pagado, se confirmara cuando se confirmara, no lo que entró a la cuenta en esas fechas; las cifras pasadas siguen cambiando.",
  "La comparación ya viene calculada y dice qué cifra es cuál: no la recalcules ni la inviertas, y no ajustes los porcentajes redondeados.",
  "Nunca sumes montos de monedas distintas.",
].join(" ");

/** The refusal of a period, worded for the agent: the field and the remedy. Dates echo as `AAAA-MM-DD`, the format of the input. */
export function periodRefusalMessage(refusal: PeriodRefusal): string {
  switch (refusal.kind) {
    case "only_through": return "Indica también la fecha inicial (desde).";
    case "reversed": return reversedRangeMessage("", refusal.from, refusal.through);
    case "from_after_today": return `La fecha inicial (${refusal.from}) es posterior a hoy (${refusal.today}).`;
    case "too_long": return `El periodo puede tener hasta ${refusal.maxDays} días. Pide uno más corto.`;
  }
}
