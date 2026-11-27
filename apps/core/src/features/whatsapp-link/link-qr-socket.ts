import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { linkQrSocketPath, type LinkQrSocketMessage } from "@shared/contracts/whatsapp-link-qr";
import { requireCompany } from "@core/src/features/users";
import { resolveCurrentAccess } from "@core/src/shared/infrastructure/current-user";
import { log } from "@core/src/shared/infrastructure/logger";
import type { LinkQrHub } from "@core/src/features/whatsapp-link/link-qr-hub";

const heartbeatMs = 30_000;

function toHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === "string") headers.set(key, value);
    else if (Array.isArray(value)) for (const item of value) headers.append(key, item);
  }
  return headers;
}

/** The session cookie travels with any cross-site WebSocket, so only the page's own origin may open one. */
function isSameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (!origin) return false;
  try { return new URL(origin).host === request.headers.host; } catch { return false; }
}

function reject(socket: Duplex, status: number, reason: string) {
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

async function companyOf(request: IncomingMessage): Promise<string | null> {
  const access = await resolveCurrentAccess(toHeaders(request));
  if (!access.success) return null;
  const ready = requireCompany(access.data);
  return ready.success ? ready.data.company.id : null;
}

function send(socket: WebSocket, message: LinkQrSocketMessage) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

/** Streams the company's WhatsApp link QR to the seller's signed-in browser. */
export function attachLinkQrSocket(server: Server, hub: LinkQrHub) {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  server.on("upgrade", (request, socket, head) => {
    if (new URL(request.url ?? "/", "http://local").pathname !== linkQrSocketPath) return;
    if (!isSameOrigin(request)) return reject(socket, 403, "Forbidden");
    void companyOf(request).then((companyId) => {
      if (companyId === null) return reject(socket, 401, "Unauthorized");
      sockets.handleUpgrade(request, socket, head, (client) => {
        let alive = true;
        client.on("pong", () => { alive = true; });
        const heartbeat = setInterval(() => {
          if (!alive) return client.terminate();
          alive = false;
          client.ping();
        }, heartbeatMs);
        const unsubscribe = hub.subscribe(companyId, (qr) => send(client, qr ? { type: "qr", qr } : { type: "cleared" }));
        client.on("close", () => { clearInterval(heartbeat); unsubscribe(); });
        client.on("error", () => client.terminate());
      });
    }).catch((cause: unknown) => {
      log.error({ event: "link_qr_socket_failed", err: cause }, "link_qr_socket_failed");
      reject(socket, 503, "Service Unavailable");
    });
  });
  return sockets;
}
