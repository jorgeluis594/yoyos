import { z } from "zod";

export const imageResponseSchema = z.object({
  id: z.uuid(),
  url: z.url().refine((value) => /^https?:\/\//i.test(value)),
}).readonly();

/** Read by the server, the web editor and the mobile app, so no client checks a different number than the server. */
export const imageUploadLimits = { maxBytes: 10_000_000, maxSide: 8000, maxPixels: 24_000_000 } as const;

export type ImageResponse = z.infer<typeof imageResponseSchema>;
