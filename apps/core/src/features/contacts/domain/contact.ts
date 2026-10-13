export type CustomerId = string & { readonly __brand: "CustomerId" };

export type WhatsAppContact = Readonly<{ id: string; whatsappAccountId: string; whatsappLid: string; createdAt: Date; updatedAt: Date }>;

export function validWhatsAppLid(value: string): boolean {
  return value.length <= 128 && /^[0-9]+@lid$/.test(value);
}
