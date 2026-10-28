import { useEffect } from "react";
import type { NoticesController } from "../application/notices-controller";
import type { NoticeInbox } from "../application/open-notice";

/**
 * Keeps every notice the seller taps, signed in or not, until a session can open it. It sits above
 * the access state because a tap can arrive while the session is restoring or signed out.
 */
export function NoticeResponseCapture({ controller, inbox }: Readonly<{ controller: NoticesController; inbox: NoticeInbox }>) {
  useEffect(() => controller.watchResponses((destination) => inbox.hold(destination)), [controller, inbox]);
  return null;
}
