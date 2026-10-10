import * as Crypto from "expo-crypto";
import { createWhatsAppRuntime, type WhatsAppRuntime } from "@mobile/features/whatsapp/composition";
import type { WhatsAppGateway } from "@mobile/features/whatsapp/application/ports";
import { openWhatsAppDatabase } from "@mobile/features/whatsapp/infrastructure/local-database";
import { request, sessionGeneration } from "@mobile/composition/auth";
import { whatsapp } from "@mobile/composition/whatsapp";

const client = whatsapp.client;
const gateway: WhatsAppGateway = {
  initialize: () => whatsapp.initialize(),
  connect: () => client.connect(),
  disconnect: () => client.disconnect(),
  logout: () => client.logout(),
  confirmMessageStored: (deliveryId) => client.confirmMessageStored(deliveryId),
  downloadImage: (reference) => client.downloadImage(reference),
  deleteDownloadedImage: (messageId) => client.deleteDownloadedImage(messageId),
  addListener: (event, listener) => client.addListener(event, listener),
};

let runtime: Promise<WhatsAppRuntime> | undefined;

/** The single runtime of the app, created on first use because the encrypted database opens asynchronously. */
export function getWhatsAppRuntime(): Promise<WhatsAppRuntime> {
  runtime ??= openWhatsAppDatabase().then((database) => createWhatsAppRuntime({
    database,
    request,
    gateway,
    generation: sessionGeneration,
    newId: () => Crypto.randomUUID(),
    now: () => new Date(),
    random: Math.random,
    schedule: (ms, run) => { const handle = setTimeout(run, ms); return () => clearTimeout(handle); },
  })).catch((error: unknown) => {
    runtime = undefined;
    throw error;
  });
  return runtime;
}
