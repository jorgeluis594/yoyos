import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { WhatsAppConnection } from "@core/src/features/chats/infrastructure/whatsapp-connections";

const mediaUrlSchema = z.object({ url: z.string().url(), mime_type: z.string(), file_size: z.number().int().positive().optional() }).passthrough();
const maxBytes = 10_000_000;
const allowedMediaHosts = ["lookaside.fbsbx.com", "scontent.whatsapp.net", "mmg.whatsapp.net"];

export async function downloadWhatsAppMedia(connection: WhatsAppConnection, mediaId: string) {
  const version = process.env.WHATSAPP_GRAPH_API_VERSION;
  if (!version || !/^v\d+\.\d+$/.test(version)) return err({ code: "MEDIA_SERVICE_UNAVAILABLE", message: "WhatsApp API version is not configured" });
  try {
    const metadata = await fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(mediaId)}`, {
      headers: { Authorization: `Bearer ${connection.accessToken}` }, redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    if (!metadata.ok) return err({ code: metadata.status >= 500 || metadata.status === 429 ? "MEDIA_UNAVAILABLE" : "INVALID_MEDIA_RESPONSE", message: "Unable to obtain media metadata" });
    const media = mediaUrlSchema.safeParse(await metadata.json());
    if (!media.success || media.data.file_size && media.data.file_size > maxBytes) return err({ code: "INVALID_MEDIA_RESPONSE", message: "Invalid media metadata" });
    const url = new URL(media.data.url);
    if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443"
      || !allowedMediaHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) return err({ code: "INVALID_MEDIA_RESPONSE", message: "Untrusted media host" });
    const response = await fetch(url, { headers: { Authorization: `Bearer ${connection.accessToken}` }, redirect: "error", signal: AbortSignal.timeout(30_000) });
    if (!response.ok || !response.body) return err({ code: response.status >= 500 || response.status === 429 ? "MEDIA_UNAVAILABLE" : "INVALID_MEDIA_RESPONSE", message: "Unable to download media" });
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) return err({ code: "INVALID_MEDIA_RESPONSE", message: "Media exceeds size limit" });
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) { await reader.cancel(); return err({ code: "INVALID_MEDIA_RESPONSE", message: "Media exceeds size limit" }); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return ok({ bytes, filename: `${mediaId}`, declaredContentType: media.data.mime_type });
  } catch (cause) {
    console.error("WhatsApp media download failed", { error: cause instanceof Error ? cause.name : "unknown" });
    return err({ code: "MEDIA_UNAVAILABLE", message: "WhatsApp media is unavailable" });
  }
}
