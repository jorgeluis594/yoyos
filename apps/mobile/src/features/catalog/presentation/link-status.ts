import type { TFunction } from "i18next";
import type { LinkFieldState } from "@mobile/features/catalog/domain/catalog-link";
import type { LinkNotice } from "@mobile/features/catalog/presentation/use-catalog-link";

export type LinkStatus = Readonly<{ text: string; tone: "neutral" | "success" | "error"; success: boolean; announce: boolean }>;

const reasonKeys = {
  contains_domain: "catalogLinkContainsDomain", contains_space: "catalogLinkContainsSpace", invalid_character: "catalogLinkInvalidCharacter",
  too_long: "catalogLinkTooLong", hyphen_edge: "catalogLinkHyphenEdge", double_hyphen: "catalogLinkDoubleHyphen",
} as const;
const noticeKeys = {
  not_sent: "catalogLinkNotSent", failed: "catalogLinkSaveFailed", in_doubt: "catalogLinkInDoubt",
  in_doubt_offline: "catalogLinkInDoubtOffline", not_saved: "catalogLinkNotSaved",
} as const;

function fieldStatus(t: TFunction, field: LinkFieldState, domain: string, raceLost: boolean): LinkStatus {
  const host = (subdomain: string) => `${subdomain}.${domain}`;
  switch (field.kind) {
    case "empty": case "short": case "typing": return { text: t("catalogLinkHelp"), tone: "neutral", success: false, announce: false };
    case "checking": return { text: t("catalogLinkChecking"), tone: "neutral", success: false, announce: false };
    case "invalid": return { text: t(reasonKeys[field.reason], { domain }), tone: "error", success: false, announce: true };
    case "reserved": return { text: t("catalogLinkReserved"), tone: "error", success: false, announce: true };
    case "in_use": return { text: t(raceLost ? "catalogLinkTaken" : "catalogLinkInUse", { host: host(field.subdomain) }), tone: "error", success: false, announce: true };
    case "available": return { text: t("catalogLinkAvailable", { host: host(field.subdomain) }), tone: "success", success: true, announce: true };
    case "saved": return { text: t("catalogLinkSaved"), tone: "success", success: true, announce: true };
    case "current": return { text: t("catalogLinkCurrent"), tone: "neutral", success: false, announce: false };
    case "check_failed": return { text: t("catalogLinkCheckFailed"), tone: "error", success: false, announce: true };
  }
}

/** The one status line under the field: the outcome of the last save when there is one, joined with the verdict once it is final. */
export function linkStatus(t: TFunction, field: LinkFieldState, notice: LinkNotice | null, domain: string, raceLost: boolean): LinkStatus {
  const fromField = fieldStatus(t, field, domain, raceLost);
  if (notice === null) return fromField;
  const text = t(noticeKeys[notice]);
  if (notice !== "not_saved") return { text, tone: "error", success: false, announce: true };
  // «Tu link no se guardó.» stays until the next edit; the verdict joins it without replacing it.
  return fromField.announce ? { ...fromField, text: `${text} ${fromField.text}` } : { text, tone: "error", success: false, announce: false };
}
