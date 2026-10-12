import { useWhatsApp } from "@mobile/features/whatsapp/presentation/whatsapp-provider";
import type { WhatsAppStatus } from "@mobile/features/whatsapp/presentation/whatsapp-status";

export function useWhatsAppStatus(): WhatsAppStatus {
  return useWhatsApp().status;
}
