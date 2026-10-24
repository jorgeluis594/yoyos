import { z } from "zod";

const tokenSchema = z.string().trim().min(1).max(256);

export const registerPushDeviceRequestSchema = z.strictObject({
  version: z.literal(1),
  token: tokenSchema,
  platform: z.enum(["ios", "android"]),
  locale: z.enum(["es", "pt-BR"]),
});
export type RegisterPushDeviceRequest = z.infer<typeof registerPushDeviceRequestSchema>;

export const unregisterPushDeviceRequestSchema = z.strictObject({ version: z.literal(1), token: tokenSchema });
export type UnregisterPushDeviceRequest = z.infer<typeof unregisterPushDeviceRequestSchema>;
