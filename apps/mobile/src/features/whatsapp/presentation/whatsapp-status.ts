import type { ConnectionState, WhatsAppErrorCode } from "@mobile/modules/whatsapp/types";
import type { ReceptionStatus } from "@mobile/features/whatsapp/application/reception-lifecycle";
import type { WhatsAppLink } from "@mobile/features/whatsapp/domain/link";

export type WhatsAppStatus = Readonly<{
  link: "none" | "otherCompany" | "linked";
  connection: ConnectionState;
  qr: Readonly<{ value: string; expiresAt: number }> | null;
  notice: WhatsAppErrorCode | null;
  lastError: ReceptionStatus["lastError"];
  unsynced: number;
}>;

export const initialWhatsAppStatus: WhatsAppStatus = {
  link: "none", connection: "disconnected", qr: null, notice: null, lastError: null, unsynced: 0,
};

export function toWhatsAppStatus(input: Readonly<{
  activeLink: WhatsAppLink | null;
  companyId: string;
  reception: ReceptionStatus;
  unsynced: number;
}>): WhatsAppStatus {
  const link = input.activeLink === null ? "none" : input.activeLink.companyId === input.companyId ? "linked" : "otherCompany";
  return { link, ...input.reception, unsynced: input.unsynced };
}
