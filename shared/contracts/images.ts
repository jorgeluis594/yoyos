import { z } from "zod";

export const imageResponseSchema = z.object({
  id: z.uuid(),
  url: z.url().refine((value) => /^https?:\/\//i.test(value)),
}).readonly();

export type ImageResponse = z.infer<typeof imageResponseSchema>;
