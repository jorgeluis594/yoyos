import { assignLink, type WhatsAppLink } from "@mobile/features/whatsapp/domain/link";
import type { CompanyId, LinkId, UserId, WhatsAppAccountId } from "@mobile/features/whatsapp/domain/ids";

const account = "1@lid" as WhatsAppAccountId;
const link = (id: string, accountId: string | null, ended = false): WhatsAppLink => ({
  id: id as LinkId, companyId: "c" as CompanyId, linkedByUserId: "u" as UserId,
  accountId: accountId as WhatsAppAccountId | null, startedAt: new Date(0), endedAt: ended ? new Date(1) : null,
});

test("returns the existing link already assigned to the account", () => {
  const assigned = link("a", "1@lid");
  expect(assignLink([link("b", null), assigned], account)).toEqual({ kind: "existing", link: assigned });
});

test("prefers an ended link of the same account over claiming the active one", () => {
  const ended = link("old", "1@lid", true);
  expect(assignLink([link("active", null), ended], account)).toEqual({ kind: "existing", link: ended });
});

test("claims the active link that has no account yet", () => {
  const active = link("active", null);
  expect(assignLink([link("ended", "2@lid", true), active], account)).toEqual({ kind: "claim", link: active });
});

test("returns orphan when the active link belongs to another account", () => {
  expect(assignLink([link("active", "2@lid")], account)).toEqual({ kind: "orphan" });
});

test("returns orphan when there are no links", () => {
  expect(assignLink([], account)).toEqual({ kind: "orphan" });
  expect(assignLink([link("ended", null, true)], account)).toEqual({ kind: "orphan" });
});
