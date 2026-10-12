import type { CompanyId, LinkId, UserId, WhatsAppAccountId } from "@mobile/features/whatsapp/domain/ids";

export type WhatsAppLink = Readonly<{
  id: LinkId;
  companyId: CompanyId;
  linkedByUserId: UserId;
  /** Fixed by the first message; the library does not expose it on connect. */
  accountId: WhatsAppAccountId | null;
  startedAt: Date;
  /** null = active. At most one active link per installation. */
  endedAt: Date | null;
}>;

export type LinkAssignment =
  | Readonly<{ kind: "existing"; link: WhatsAppLink }>
  | Readonly<{ kind: "claim"; link: WhatsAppLink }>
  | Readonly<{ kind: "orphan" }>;

/** Prefers the link already assigned to the account (even an ended one), then claims the active link without account. */
export function assignLink(links: readonly WhatsAppLink[], accountId: WhatsAppAccountId): LinkAssignment {
  const existing = links.find((link) => link.accountId === accountId);
  if (existing) return { kind: "existing", link: existing };
  const claimable = links.find((link) => link.endedAt === null && link.accountId === null);
  return claimable ? { kind: "claim", link: claimable } : { kind: "orphan" };
}
