import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { NoticeLocale, PushDevice, PushDeviceId } from "@core/src/features/notifications/domain/push-device";

/** What orders hands over when it claims a notice. Notifications never looks inside `notice`, except for its kind in logs. */
export type NoticeClaim = Readonly<{ messageId: string; chatId: string; sessionId: string; notice: Readonly<{ kind: string }> }>;
export type RenderedNotice = Readonly<{ title: string; body: string; data: Readonly<Record<string, unknown>>; groupKey: string }>;

export type NoticeError = Readonly<{ code: string; message: string; retryable?: boolean }>;
export type PushSendError = Readonly<{ code: "DEVICE_NOT_REGISTERED" | "PROVIDER_UNAVAILABLE" | "PROVIDER_REJECTED" | "SEND_TIMEOUT"; message: string; retryable: boolean }>;

export type SendChatMessageNoticeDependencies<Claim extends NoticeClaim = NoticeClaim> = Readonly<{
  /** `null` when the notice was already sent or none is due. */
  claimNotice: (messageId: string) => Promise<Result<Claim | null, NoticeError>>;
  describeNotice: (claim: Claim, locale: NoticeLocale) => Promise<Result<RenderedNotice, NoticeError>>;
  releaseNotice: (messageId: string) => Promise<Result<null, NoticeError>>;
  /** Joins the session (unexpired) to its user's company; `null` when there is no device for that company. */
  findDeviceForSession: (sessionId: string, companyId: string) => Promise<Result<PushDevice | null, NoticeError>>;
  sendPush: (device: PushDevice, notice: RenderedNotice, signal: AbortSignal) => Promise<Result<null, PushSendError>>;
  removeDevice: (deviceId: PushDeviceId) => Promise<Result<null, NoticeError>>;
  onSent?: (event: Readonly<{ noticeKind: string; durationMs: number }>) => void;
}>;

export type SendChatMessageNoticeOutcome =
  | Readonly<{ status: "sent" }>
  | Readonly<{ status: "dropped"; reason: "already_sent" | "no_device" | "device_not_registered" | "provider_rejected" | "timeout" }>;

export type SendChatMessageNoticeError = Readonly<{ code: string; message: string; retryable: boolean }>;

export const noticeSendTimeoutMs = 10_000;

const retryable = (error: NoticeError): SendChatMessageNoticeError => ({ code: error.code, message: error.message, retryable: error.retryable ?? true });

export async function sendChatMessageNotice<Claim extends NoticeClaim>(
  input: Readonly<{ companyId: string; messageId: string }>,
  _context: Readonly<{ attempt: number }>,
  deps: SendChatMessageNoticeDependencies<Claim>,
): Promise<Result<SendChatMessageNoticeOutcome, SendChatMessageNoticeError>> {
  const claimed = await deps.claimNotice(input.messageId);
  if (!claimed.success) return err(retryable(claimed.error));
  const claim = claimed.data;
  if (!claim) return ok({ status: "dropped", reason: "already_sent" });

  // From here the claim is taken: a failure before sending releases it so a retry can send the notice.
  // If the release itself fails the claim stays, and the retry then finds the notice claimed and drops it.
  const release = async (error: NoticeError) => {
    const released = await deps.releaseNotice(input.messageId);
    return err(retryable(released.success ? error : released.error));
  };
  const found = await deps.findDeviceForSession(claim.sessionId, input.companyId);
  if (!found.success) return release(found.error);
  const device = found.data;
  if (!device) return ok({ status: "dropped", reason: "no_device" });

  const rendered = await deps.describeNotice(claim, device.locale);
  if (!rendered.success) return release(rendered.error);

  const startedAt = Date.now();
  const sent = await deps.sendPush(device, rendered.data, AbortSignal.timeout(noticeSendTimeoutMs));
  if (sent.success) {
    deps.onSent?.({ noticeKind: claim.notice.kind, durationMs: Date.now() - startedAt });
    return ok({ status: "sent" });
  }
  if (sent.error.code === "DEVICE_NOT_REGISTERED") {
    const removed = await deps.removeDevice(device.id);
    if (!removed.success) return err(retryable(removed.error));
    return ok({ status: "dropped", reason: "device_not_registered" });
  }
  // No provider answer is an unknown outcome: the notice may have been delivered, so the claim stays and nothing is retried.
  if (sent.error.code === "SEND_TIMEOUT") return ok({ status: "dropped", reason: "timeout" });
  if (sent.error.retryable) return release(sent.error);
  return ok({ status: "dropped", reason: "provider_rejected" });
}
