export type WhatsAppConnection = Readonly<{ companyId: string; phoneNumberId: string; businessAccountId: string; connectedAt: Date; accessToken: string }>;

export function loadWhatsAppConnections(value = process.env.WHATSAPP_CONNECTIONS_JSON ?? "[]"): readonly WhatsAppConnection[] {
  const input: unknown = JSON.parse(value);
  if (!Array.isArray(input)) throw new Error("WHATSAPP_CONNECTIONS_JSON must be an array");
  const connections = input.map((item) => {
    if (typeof item !== "object" || item === null) throw new Error("Invalid WhatsApp connection");
    const row = item as Record<string, unknown>;
    if (!["companyId", "phoneNumberId", "businessAccountId", "connectedAt", "accessToken"].every((key) => typeof row[key] === "string" && row[key])
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(row.companyId))) throw new Error("Invalid WhatsApp connection");
    const connectedAt = new Date(row.connectedAt as string);
    if (!Number.isFinite(connectedAt.getTime())) throw new Error("Invalid WhatsApp connection date");
    return { companyId: row.companyId as string, phoneNumberId: row.phoneNumberId as string, businessAccountId: row.businessAccountId as string, connectedAt, accessToken: row.accessToken as string };
  });
  if (new Set(connections.map(({ companyId }) => companyId)).size !== connections.length || new Set(connections.map(({ phoneNumberId }) => phoneNumberId)).size !== connections.length) {
    throw new Error("WhatsApp company and phone number connections must be unique");
  }
  return connections;
}
