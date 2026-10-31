import { createInstance } from "i18next";
import resources from "@core/app/locales";
import type { ProjectableReadiness } from "@core/src/features/assistants/domain/order-projection";

const translations = createInstance();
void translations.init({ lng: "es", fallbackLng: "es", resources, initAsync: false, interpolation: { escapeValue: false } });
const t = translations.getFixedT("es", "translation");

/**
 * The readiness sentences are the ones the web shows next to «Marcar enviado» and «Marcar entregado» (`orderFulfillment` in `app/locales.ts`),
 * so the tool and the button never drift. `shortItems` are the names of the short items and `owed` the formatted balance.
 */
export function readinessText(readiness: ProjectableReadiness, shortItems: readonly string[], owed: string | null): string {
  if (readiness.kind === "ready") return readiness.operation === "ship" ? "Listo para despachar" : "Listo para entregar";
  if (readiness.kind === "delivery_unassigned") return "Entrega por definir: falta asignar la entrega.";
  const { reason, operation } = readiness;
  switch (reason.code) {
    case "SHIP_PAYMENT_REQUIRED": return `${t("orderFulfillment.SHIP_PAYMENT_REQUIRED")}${reason.pendingReport ? ` ${pendingReportSentence}` : ""}`;
    case "PAYMENT_REQUIRED": return [t("orderFulfillment.PAYMENT_REQUIRED"), owed ? `Por cobrar: ${owed}.` : "", reason.pendingReport ? pendingReportSentence : ""].filter(Boolean).join(" ");
    case "STOCK_WAITING": return t(`orderFulfillment.STOCK_WAITING_${operation}`, { items: shortItems.join(", ") });
  }
}

export const pendingReportSentence = "Tiene un pago por revisar.";
export const noOrderMessage = (number: number) => `No hay un pedido #${number} en tu tienda.`;
export const noMatchesMessage = "No hay pedidos con esos filtros.";
export const noOrdersMessage = "Tu tienda todavía no tiene pedidos.";
export const noUnpaidMessage = "No tienes pedidos por cobrar.";
export const noDispatchMessage = "No tienes pedidos para despachar hoy.";
export const unknownCourierMessage = (name: string, couriers: readonly string[]) =>
  `Tu tienda no tiene el courier "${name}". Couriers: ${couriers.length === 0 ? "ninguno" : couriers.join(", ")}.`;
export const ambiguousCourierMessage = (name: string, matches: readonly string[]) =>
  `El courier "${name}" coincide con varios: ${matches.join(", ")}. Indica el nombre completo.`;
export const reversedRangeMessage = (field: string, from: string, to: string) =>
  `${field === "" ? "" : `${field}: `}La fecha final (${to}) es anterior a la inicial (${from}).`;
export const todayLine = (day: string) => `Hoy es ${day}`;
export const moreLine = (nextPage: number) => `hay más: pide la página ${nextPage}`;
export const undatedLine = (count: number) => `Además hay ${count} ${count === 1 ? "pedido pendiente" : "pedidos pendientes"} sin fecha de despacho.`;
export const unpaidSummaryLine = (count: number, owed: string) => `${count} ${count === 1 ? "pedido" : "pedidos"}, ${owed} por cobrar`;
export const pendingReportsLine = (count: number) => (count === 1 ? "1 tiene un pago por revisar" : `${count} tienen un pago por revisar`);
export const dispatchSummaryLine = (summary: Readonly<{ overdue: number; overdueReady: number; today: number; todayReady: number }>) => {
  const part = (label: string, total: number, ready: number) => `${label}: ${total}, ${ready} ${ready === 1 ? "listo" : "listos"}.`;
  return `${part("Atrasados", summary.overdue, summary.overdueReady)} ${part("Para hoy", summary.today, summary.todayReady)}`;
};

const dateFormat = "Usa el formato AAAA-MM-DD, por ejemplo 2026-10-30.";
export const dateFormatMessage = dateFormat;

export const orderToolsInstructions = [
  "Este conector lee los pedidos de una sola tienda, la que autorizó la conexión, y no puede cambiar nada.",
  "Si el dueño pide cambiar un pedido (cancelarlo, registrar un pago, marcarlo como enviado), dile que lo haga en Yoyos y dale el enlace del pedido que viene en cada resultado.",
  "Los montos, las fechas y los estados ya vienen listos para mostrar; no los recalcules.",
  "Los teléfonos y las direcciones de los clientes se ocultan a propósito: nunca digas que puedes obtenerlos.",
  "Si una llamada se rechaza por falta de autorización, pide al dueño que vuelva a conectar el conector desde la configuración de tu asistente; la dirección está en Yoyos → Ajustes → Asistentes de IA.",
  "Este conector todavía no da totales de ventas ni finanzas: dilo en vez de sumar páginas de pedidos.",
  "Cuando repitas el motivo por el que un pedido no está listo, cítalo tal cual en vez de convertirlo en una promesa; «Tiene un pago por revisar.» significa pedir al dueño que revise ese reporte en Yoyos (con el enlace del pedido), no que registre un pago.",
  "Cada lista indica «Hoy es …» en Lima: calcula los rangos relativos («la semana pasada») con esa fecha y no con tu reloj.",
].join(" ");

export const searchOrdersDescription = [
  "Busca pedidos de la tienda. Úsala cuando el dueño nombre a un cliente, un número, un estado o un rango de fechas («los pedidos de Carla», «lo que despaché la semana pasada con Olva»).",
  "No la uses para «¿quién me debe?» (usa pedidos_por_cobrar) ni para «¿qué despacho hoy?» (usa pedidos_por_despachar_hoy). Para un pedido cuyo número se conoce usa ver_pedido.",
  "Todos los filtros son opcionales y se combinan. texto: número de pedido o parte del nombre del cliente; no busca por teléfono. Si el texto lleva algún dígito se busca solo por número de pedido, nunca por el nombre: un cliente sin nombre («Cliente que termina en 427») o con un número en su nombre solo se encuentra por número de pedido o por los otros filtros; díselo al dueño en vez de adivinar o paginar todos los pedidos.",
  "pago: «por cobrar» o «pagado». entrega: «pendiente», «despachada» o «entregada». incluir_cancelados: false por defecto; se ignora cuando das pago, porque por cobrar y pagado nunca incluyen pedidos cancelados.",
  "courier: nombre del courier (también los deshabilitados que aún tienen pedidos). Fechas como AAAA-MM-DD, días completos en hora de Lima con ambos extremos incluidos: creado_desde/creado_hasta, despacho_programado_desde/despacho_programado_hasta (o sin_fecha_de_despacho), despachado_desde/despachado_hasta. pagina: 20 pedidos por página, los más recientes primero.",
  "Cada pedido trae número, fecha, cliente, origen, total, estado de pago y lo que falta cobrar, estado de entrega, modalidad, courier, fecha de despacho programada y enlace. No trae si está listo para despachar ni el distrito de destino: eso solo está en ver_pedido y pedidos_por_despachar_hoy; no lo adivines.",
].join(" ");

export const viewOrderDescription = [
  "Muestra todo lo de un pedido que el dueño nombra por su número («¿cómo va el #1042?», el cliente pregunta si salió su pedido). Si el dueño nombra a un cliente en vez de un número, usa primero buscar_pedidos.",
  "numero: «1042» o «#1042». Devuelve fechas, origen, cliente, cada producto con su combinación, cantidad y precios, totales, recibido y saldo, los pagos (estado, monto y método si está confirmado, fecha, motivo si fue rechazado; un comprobante se menciona como «con comprobante», nunca se envía), la entrega (modalidad, destinatario, teléfono terminado en tres dígitos y destino sin calle ni referencia), si espera o descuenta stock, si está lista para despachar mientras la entrega esté pendiente y el enlace.",
  "Un número desconocido o de otra tienda responde igual: «No hay un pedido #N en tu tienda.».",
].join(" ");

export const unpaidOrdersDescription = [
  "Lista los pedidos por cobrar: no cancelados cuyos pagos confirmados no cubren el total. Úsala para «¿quién me debe?» o «¿cuánto me falta cobrar?».",
  "Empieza con un resumen sobre todos los pedidos por cobrar, no solo la página: cantidad, total por cobrar y cuántos tienen un pago por revisar (un pago reportado no cuenta hasta que el dueño lo confirma). Luego los pedidos, 20 por página, con número, fecha, cliente, total, recibido, por cobrar, «pago por revisar» y enlace.",
  "pagina: opcional. Para buscar por cliente o fecha usa buscar_pedidos.",
].join(" ");

export const dispatchTodayDescription = [
  "Lista los pedidos por despachar hoy: no cancelados, con entrega pendiente y fecha de despacho programada de hoy o anterior (hora de Lima). Úsala para «¿qué despacho hoy?» o «¿qué preparo?».",
  "Primero el resumen («Atrasados: 2, 1 listo. Para hoy: 6, 4 listos.»), luego el grupo «Atrasados» y después «Para hoy»; dentro de cada grupo, primero los listos y luego los bloqueados, y en cada parte la fecha programada más antigua y el número más bajo. Cada pedido trae cliente, modalidad, courier o punto de recojo, distrito de destino, pago y saldo, si está listo con su motivo y el enlace.",
  "Un pedido bloqueado trae el motivo: nunca le digas al dueño que está listo. La preparación se calcula pedido por pedido y no reserva stock entre ellos: si varios pedidos listos comparten un producto, avisa que solo se podrán despachar tantos como stock haya.",
  "Termina con cuántos pedidos pendientes no tienen fecha de despacho; ofrece verlos con buscar_pedidos y sin_fecha_de_despacho. pagina: 20 pedidos por página en una sola secuencia, los atrasados primero.",
].join(" ");
