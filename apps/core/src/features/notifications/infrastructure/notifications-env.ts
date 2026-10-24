import { z } from "zod";

const environmentSchema = z.object({
  PUSH_PROVIDER: z.enum(["expo", "none"]).default("none"),
  EXPO_ACCESS_TOKEN: z.string().trim().optional().transform((value) => value || undefined),
  PUSH_NOTICE_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(600),
});

export type NotificationsEnv = z.infer<typeof environmentSchema>;

/** Throws on an invalid value so a misconfigured deploy fails at startup, not at the first notice. */
export function readNotificationsEnv(source: Readonly<Record<string, string | undefined>> = process.env): NotificationsEnv {
  return environmentSchema.parse({
    PUSH_PROVIDER: source.PUSH_PROVIDER || undefined,
    EXPO_ACCESS_TOKEN: source.EXPO_ACCESS_TOKEN,
    PUSH_NOTICE_TTL_SECONDS: source.PUSH_NOTICE_TTL_SECONDS || undefined,
  });
}
