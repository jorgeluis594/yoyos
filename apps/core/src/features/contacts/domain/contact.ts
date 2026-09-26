export type Contact = Readonly<{ id: string; phone: string; name: string | null; createdAt: Date; updatedAt: Date }>;

export function normalizePhone(phone: string): string | null {
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) return null;
  return phone;
}
