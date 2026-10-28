import { z } from "zod";

/** The `data` of a seller notice push, as the app reads it. */
const noticeDestinationSchema = z.strictObject({
  v: z.literal(1),
  companyId: z.uuid(),
  messageId: z.uuid(),
  target: z.enum(["message", "order"]),
});
export type NoticeDestination = z.infer<typeof noticeDestinationSchema>;
export type NoticeSession = Readonly<{ companyId: string }> | null;

/** Reads the `data` of a push; anything that is not a v1 seller notice is `null`. */
export function parseNoticeDestination(data: unknown): NoticeDestination | null {
  const parsed = noticeDestinationSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

/** A notice is shown only to the company that owns it; a signed-out phone shows none. */
export function shouldShowNotice(data: unknown, session: NoticeSession): boolean {
  const destination = parseNoticeDestination(data);
  return destination !== null && session !== null && destination.companyId === session.companyId;
}
