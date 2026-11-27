import { deliveryBadgeLabel, deliveryStatusLabel, documentTypeLabel, orderLanguage, orderStatusLabel } from "@mobile/features/orders/presentation/order-labels";

test("order labels follow language and country without changing stored codes", () => {
  expect(orderStatusLabel("completed", orderLanguage("PE", "es-PE"))).toBe("Venta completada");
  expect(deliveryStatusLabel("pending", orderLanguage("US", "en-US"))).toBe("Delivery pending");
  expect(deliveryBadgeLabel("pending", orderLanguage("PE", "es-PE"))).toBe("Pendiente");
  expect(deliveryBadgeLabel("shipped", orderLanguage("PE", "es-PE"))).toBe("Enviado");
  expect(documentTypeLabel("foreign_id", orderLanguage("BR", "pt-BR"))).toBe("Documento de estrangeiro");
  expect(documentTypeLabel("passport", orderLanguage("PE", "en-US"))).toBe("Passport");
  expect(orderLanguage("BR", "fr-FR")).toBe("pt");
});
