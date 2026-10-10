import type { Result } from "@shared/result";

export type WhatsAppErrorCode =
  | "MODULE_UNAVAILABLE" | "NOT_INITIALIZED" | "INVALID_INPUT" | "INVALID_NATIVE_RESPONSE" | "NATIVE_CALL_FAILED"
  | "CONNECTION_FAILED" | "SESSION_EXPIRED" | "SESSION_STORAGE_FAILED" | "SESSION_STORAGE_LIMIT_REACHED"
  | "SESSION_STATE_INVALID" | "IDENTITY_UNAVAILABLE" | "ACCOUNT_NOT_CONNECTED" | "RECOVERY_BUFFER_FULL"
  | "HISTORY_LIMIT_REACHED" | "STORAGE_LIMIT_REACHED" | "IMAGE_UNAVAILABLE" | "IMAGE_DOWNLOAD_FAILED"
  | "IMAGE_DELETE_FAILED" | "REMOTE_LOGOUT_UNCONFIRMED";

export type WhatsAppError = { code: WhatsAppErrorCode; message: string };
export type ConnectionState = "disconnected" | "connecting" | "awaitingQr" | "connected" | "reconnecting" | "sessionExpired";
export type WhatsAppOptions = { maxImageStorageBytes?: number; maxRecoveryBufferBytes?: number };
export type ImageReference = { messageId: string; downloadReference: string };
export type ReceivedMessage = {
  id: string; accountId: string; whatsappMessageId: string; chatId: string;
  direction: "incoming" | "outgoing"; timestamp: number; text?: string;
  image?: { mimeType?: string; size?: number; reference: ImageReference };
};
export type DownloadedImage = { uri: string; mimeType: string; size: number };
export type WhatsAppEvents = {
  qr: { value: string; expiresAt: number };
  connectionChanged: { state: ConnectionState };
  messageReceived: { deliveryId: string; message: ReceivedMessage };
  error: WhatsAppError;
};
export interface WhatsAppClient {
  initialize(options?: WhatsAppOptions): Promise<Result<void, WhatsAppError>>;
  connect(): Promise<Result<void, WhatsAppError>>;
  disconnect(): Promise<Result<void, WhatsAppError>>;
  logout(): Promise<Result<void, WhatsAppError>>;
  confirmMessageStored(deliveryId: string): Promise<Result<void, WhatsAppError>>;
  downloadImage(reference: ImageReference): Promise<Result<DownloadedImage, WhatsAppError>>;
  deleteDownloadedImage(messageId: string): Promise<Result<void, WhatsAppError>>;
  addListener<E extends keyof WhatsAppEvents>(event: E, listener: (payload: WhatsAppEvents[E]) => void): { remove(): void };
}
