import { WhatsApp } from "@mobile/modules/whatsapp";
import type { WhatsAppClient } from "@mobile/modules/whatsapp/types";
import { createWhatsAppComposition } from "./create-whatsapp-composition";

// Expo inlines EXPO_PUBLIC_* only for a static `process.env.NAME` access, so it is read here and
// nowhere else: changing it needs a new JavaScript bundle, and neither Go nor the native layers read `.env`.
export const whatsapp = createWhatsAppComposition(WhatsApp as WhatsAppClient, process.env.EXPO_PUBLIC_WHATSAPP_RECOVERY_BUFFER_MIB);
