import type { Country } from "@shared/country";
import type { OrderAggregateResponse } from "@shared/contracts/orders";

type Language = "es" | "en" | "pt";
type Status = OrderAggregateResponse["status"];
type Delivery = OrderAggregateResponse["deliveryStatus"];
type DocumentType = Extract<NonNullable<OrderAggregateResponse["delivery"]>["recipient"]["identity"], { kind: "document" }>["documentType"];

const labels = {
  es: { active: "Orden activa", cancelled: "Orden cancelada", completed: "Venta completada",
    pending: "Entrega pendiente", shipped: "Despachado", delivered: "Entregado",
    national_id: "Documento de identidad", passport: "Pasaporte", foreign_id: "Documento de extranjería",
    home: "Domicilio", agency: "Agencia", store: "Tienda" },
  en: { active: "Active order", cancelled: "Cancelled order", completed: "Completed sale",
    pending: "Delivery pending", shipped: "Shipped", delivered: "Delivered",
    national_id: "National ID", passport: "Passport", foreign_id: "Foreign ID",
    home: "Home delivery", agency: "Agency", store: "Store pickup" },
  pt: { active: "Pedido ativo", cancelled: "Pedido cancelado", completed: "Venda concluída",
    pending: "Entrega pendente", shipped: "Enviado", delivered: "Entregue",
    national_id: "Documento de identidade", passport: "Passaporte", foreign_id: "Documento de estrangeiro",
    home: "Entrega em domicílio", agency: "Agência", store: "Retirada na loja" },
} as const;

export function orderLanguage(country: Country, deviceLocale = Intl.DateTimeFormat().resolvedOptions().locale): Language {
  const language = deviceLocale.split("-")[0];
  return language === "es" || language === "en" || language === "pt" ? language : country === "BR" ? "pt" : country === "US" ? "en" : "es";
}

export const orderStatusLabel = (status: Status, language: Language) => labels[language][status];
export const deliveryStatusLabel = (status: Delivery, language: Language) => labels[language][status];
export const documentTypeLabel = (type: DocumentType, language: Language) => labels[language][type];
export const deliveryMethodLabel = (method: "home" | "agency" | "store", language: Language) => labels[language][method];
