import type { Currency } from "@shared/money";
import type { Display } from "@core/src/features/assistants/domain/order-projection";
import type { SalesPeriod } from "@core/src/features/assistants/domain/sales-period";
import type { Share } from "@core/src/features/assistants/domain/sales-figures";
import { counted } from "@core/src/features/assistants/domain/sales-figures";
import type { OtherCurrencySales } from "@core/src/features/assistants/domain/product-sales-projection";

/** «del 01/10/2026 al 20/10/2026 (hasta hoy)»: the period actually read, as every sales answer states it. */
export function periodPhrase(period: SalesPeriod, display: Display): string {
  return `del ${display.day(period.from)} al ${display.day(period.through)}${period.cutToToday ? " (hasta hoy)" : ""}`;
}

export const shareText = (share: Share): string => (share.kind === "percent" ? `${share.value}%` : "menos de 1%");
export const unitsText = (units: number): string => counted(units, "unidad", "unidades");

/** The sentence that says a share is of the whole period and not of the filtered products. */
export const shareLine = (share: Share): string => `${shareText(share)} de tus ventas de productos del periodo`;

export const bestSellersHeader = (phrase: string, units: number, products: number, amount: string): string =>
  `${phrase[0]!.toUpperCase()}${phrase.slice(1)}: ${unitsText(units)} de ${counted(products, "producto", "productos")}, ${amount} en productos.`;
export const bestSellersTextHeader = (phrase: string, text: string, units: number, products: number, amount: string, whole: string): string =>
  `${phrase[0]!.toUpperCase()}${phrase.slice(1)}, productos que coinciden con "${text}": ${unitsText(units)} de ${counted(products, "producto", "productos")}, ${amount} de los ${whole} que vendiste en productos.`;
export const singleProductHeader = (name: string, phrase: string, units: number, amount: string, share: Share, whole: string): string =>
  `"${name}" ${phrase}: ${unitsText(units)}, ${amount}, ${shareLine(share)} (${whole}).`;

export const noProductSalesMessage = (phrase: string): string => `No vendiste productos ${phrase}.`;
export const noProductSalesInCurrencyMessage = (currency: Currency, phrase: string): string => `No vendiste productos en ${currency} ${phrase}.`;
export const noTextSalesMessage = (text: string, phrase: string): string => `Ningún producto que coincida con "${text}" se vendió ${phrase}.`;
export const noTextSalesInCurrencyMessage = (text: string, currency: Currency, phrase: string): string => `Ningún producto que coincida con "${text}" se vendió en ${currency} ${phrase}.`;
export const noSingleProductSalesMessage = (name: string, phrase: string): string => `"${name}" no tuvo ventas ${phrase}.`;
export const noSingleProductSalesInCurrencyMessage = (name: string, currency: Currency, phrase: string): string => `"${name}" no tuvo ventas en ${currency} ${phrase}.`;
export const moreVariantsLine = (count: number): string => `y ${counted(count, "variante", "variantes")} más: pide este producto para verlas todas`;
export const ignoredWithProductNote = "Con producto se ignoran texto, orden y pagina.";

/** One line per other currency: «Además vendiste en USD: 1 pedido, 3 unidades, US$ 90.00 en productos, fuera de este ranking.» */
export function otherCurrencyLine(sale: OtherCurrencySales, display: Display, scope: Readonly<{ kind: "all" } | { kind: "text"; text: string } | { kind: "product"; name: string }>): string {
  const amount = display.money(sale.amount);
  const units = unitsText(sale.units);
  switch (scope.kind) {
    case "all": return `Además vendiste en ${sale.currency}: ${counted(sale.orders ?? 0, "pedido", "pedidos")}, ${units}, ${amount} en productos, fuera de este ranking.`;
    case "text": return `Además vendiste en ${sale.currency}, entre los productos que coinciden con "${scope.text}": ${units}, ${amount}, fuera de estas cifras.`;
    case "product": return `Además vendiste "${scope.name}" en ${sale.currency}: ${units}, ${amount}, fuera de estas cifras.`;
  }
}

export const unsoldHeader = (unsold: number, checked: number, phrase: string): string => {
  if (checked === 1) return `Tu único producto con stock no se vendió ${phrase}.`;
  return `${unsold} de tus ${checked} productos con stock ${unsold === 1 ? "no se vendió" : "no se vendieron"} ${phrase}.`;
};
export const unsoldTextHeader = (unsold: number, checked: number, text: string, phrase: string): string => {
  if (checked === 1) return `Tu único producto con stock que coincide con "${text}" no se vendió ${phrase}.`;
  return `${unsold} de tus ${checked} productos con stock que coinciden con "${text}" ${unsold === 1 ? "no se vendió" : "no se vendieron"} ${phrase}.`;
};
export const stockIsTodayNote = "El stock es el de hoy.";
export const shortPeriodNote = (days: number): string => `Este periodo tiene solo ${counted(days, "día", "días")}: para ver lo que no rota, pide al menos un mes.`;
export const noProductsAtAllMessage = "Tu tienda todavía no tiene productos.";
export const noProductMatchesMessage = (text: string): string => `Ningún producto coincide con "${text}".`;
export const noStockTodayMessage = (text: string | undefined): string => text === undefined
  ? "Ninguno de tus productos tiene stock hoy, así que no hay productos parados que revisar."
  : `Ninguno de tus productos que coinciden con "${text}" tiene stock hoy, así que no hay productos parados que revisar.`;
export const createdAfterMessage = (text: string | undefined, through: string, display: Display): string =>
  `Tus productos con stock${text === undefined ? "" : ` que coinciden con "${text}"`} se crearon después del ${display.day(through)}: ninguno estaba a la venta en esas fechas.`;
export const allSoldMessage = (checked: number, text: string | undefined, phrase: string): string => {
  if (checked === 1) return `Tu único producto con stock${text === undefined ? "" : ` que coincide con "${text}"`} tuvo ventas ${phrase}.`;
  return `Tus ${checked} productos con stock${text === undefined ? "" : ` que coinciden con "${text}"`} tuvieron ventas ${phrase}.`;
};
export const lastSaleLine = (date: string | null): string => (date === null ? "Ninguna venta antes del periodo" : `Última venta antes del periodo: ${date}`);
export const soldAgainLine = (date: string): string => `Volvió a venderse el ${date}`;
export const createdLine = (date: string): string => `Creado el ${date}`;

const periodFields = [
  "desde y hasta: fechas AAAA-MM-DD, días completos en hora de Lima con ambos extremos incluidos, sobre la fecha de creación del pedido (la misma de creado_desde y creado_hasta de buscar_pedidos), nunca la de despacho, entrega o pago.",
  "Sin fechas lee del día 1 del mes actual hasta hoy; solo con desde, hasta hoy; solo con hasta se rechaza porque falta el inicio. Un hasta futuro se lee hasta hoy y la respuesta lo dice. El periodo puede tener hasta 366 días; con demasiados pedidos pide uno más corto.",
].join(" ");

export const bestSellersDescription = [
  "Lista lo más vendido por producto en un periodo, con las variantes que se vendieron (talla, color). Úsala para «¿qué es lo que más vendí?», «¿qué talla de polo sale más?» o «¿qué producto me deja más ventas?». Para totales, pagos y comparaciones usa resumen_de_ventas; para lo que no se mueve usa productos_sin_ventas.",
  periodFields,
  "orden: «unidades» (por defecto) o «monto». pagina: 20 productos por página.",
  "texto: una frase buscada en el nombre del producto o en cualquier SKU, sin distinguir mayúsculas ni tildes; usa una palabra corta en singular o su raíz («polo» para «polos», «casac» para «casacas»). Con texto el ranking cubre solo los productos que coinciden, pero cada porcentaje sigue siendo del total de ventas de productos del periodo y la respuesta lo dice.",
  "producto: el id que devuelve esta herramienta o buscar_productos. Responde ese producto solo, con todas las variantes vendidas, sin tope; úsalo cuando una línea diga «y N variantes más» o para «¿qué talla sale más?». Con producto se ignoran texto, orden y pagina.",
  "Cada producto trae nombre, unidades, monto (suma de los subtotales de sus productos; nunca incluye el envío), su porcentaje del total de ventas de productos del periodo, id y enlace de Yoyos; debajo, hasta 3 variantes con su combinación, unidades y monto (las variantes no tienen porcentaje). Los porcentajes se redondean uno por uno y pueden sumar 99% o 101%: no los ajustes ni los recalcules.",
  "Solo se ordenan las ventas en la moneda de la tienda; cada otra moneda trae una línea aparte y nunca se suma. Los pedidos cancelados y los pedidos del catálogo sin confirmar no cuentan. No da márgenes ni costos.",
].join(" ");

export const unsoldProductsDescription = [
  "Lista los productos con stock hoy que no vendieron ninguna unidad en un periodo. Úsala para «¿qué no se está vendiendo?», «¿qué casaca no se vende?» o «¿qué tengo parado?». Para lo que sí se vendió usa lo_mas_vendido.",
  periodFields,
  "Cuando el dueño no nombre un periodo para esta pregunta, envía los últimos 30 días incluyendo hoy, contados desde la línea «Hoy es …» (desde = hoy menos 29 días, hasta = hoy; el 31/10/2026 son 2026-10-02 y 2026-10-31) en vez del mes en curso: a inicios de mes casi todo figura sin ventas. Un periodo de menos de 14 días trae un aviso para pedir al menos un mes.",
  "texto: una frase buscada en el nombre del producto o en cualquier SKU, sin distinguir mayúsculas ni tildes; usa una palabra corta en singular o su raíz («polo», «casac»). pagina: 20 productos por página.",
  "Se revisan los productos creados hasta el último día del periodo, con al menos una variante activa y stock total mayor que 0 hoy. El stock es el de hoy, no el del inicio del periodo. Cada producto trae nombre, stock con el resumen de sus variantes (sin alertas), la última venta antes del periodo («Ninguna venta antes del periodo» si no hay), «Volvió a venderse el …» solo si el periodo ya terminó y hubo una venta después, «Creado el …» si se creó dentro del periodo, id y enlace de Yoyos.",
  "Una unidad vendida en cualquier moneda cuenta como venta; la lista no trae montos. Los pedidos cancelados y los pedidos del catálogo sin confirmar nunca son una venta. Ordena por más stock, luego la venta más antigua antes del periodo (sin ventas primero) y luego el nombre.",
].join(" ");
