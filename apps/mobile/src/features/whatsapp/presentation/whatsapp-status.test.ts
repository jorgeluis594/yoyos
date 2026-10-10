import { toWhatsAppStatus } from "@mobile/features/whatsapp/presentation/whatsapp-status";
import type { CompanyId, LinkId, UserId } from "@mobile/features/whatsapp/domain/ids";

const reception = { connection: "connected", qr: null, notice: null, lastError: null } as const;
const link = (companyId: string) => ({ id: "l" as LinkId, companyId: companyId as CompanyId, linkedByUserId: "u" as UserId, accountId: null, startedAt: new Date(0), endedAt: null });

test("reports none, otherCompany or linked from the active link and the session company", () => {
  expect(toWhatsAppStatus({ activeLink: null, companyId: "c1", reception, unsynced: 0 }).link).toBe("none");
  expect(toWhatsAppStatus({ activeLink: link("c2"), companyId: "c1", reception, unsynced: 0 }).link).toBe("otherCompany");
  expect(toWhatsAppStatus({ activeLink: link("c1"), companyId: "c1", reception, unsynced: 3 })).toMatchObject({ link: "linked", connection: "connected", unsynced: 3 });
});
