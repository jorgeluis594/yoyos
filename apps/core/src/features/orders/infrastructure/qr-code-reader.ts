import type { Result } from "@shared/result";

export type QrCodeReadError = Readonly<{ code: "UNREADABLE_IMAGE" | "QR_READER_UNAVAILABLE"; message: string }>;
export type ReadQrCodes = (
  image: Readonly<{ bytes: Uint8Array; contentType: string }>,
) => Promise<Result<readonly string[], QrCodeReadError>>;
