import { describe, expect, it, vi } from "vitest";
import { ensureContact } from "@core/src/features/contacts/application/ensure-contact";
import { normalizePhone, type Contact } from "@core/src/features/contacts/domain/contact";

const companyId = "7b1d7be7-14bd-4b74-aecd-9fb56d8b64a0";
const contact: Contact = { id: "2e98e108-1821-4fd1-a507-21e3e00b76f1", companyId, phone: "+14155552671", name: null, createdAt: new Date(0), updatedAt: new Date(0) };

describe("ensureContact", () => {
  it("accepts canonical international phone and leaves missing names null", async () => {
    const findByPhone = vi.fn(async () => ({ success: true as const, data: null }));
    const insertIfAbsent = vi.fn(async (input) => ({ success: true as const, data: { ...contact, ...input } }));
    const setName = vi.fn();
    expect(normalizePhone("+14155552671")).toBe("+14155552671");
    expect(await ensureContact({ companyId, phone: "+14155552671", profileName: null }, { findByPhone, insertIfAbsent, setName })).toMatchObject({ success: true, data: { phone: "+14155552671", name: null } });
    expect(insertIfAbsent).toHaveBeenCalledWith({ companyId, phone: "+14155552671", name: null });
  });

  it("rejects invalid phone without persistence and ignores blank profile names", async () => {
    const findByPhone = vi.fn(async () => ({ success: true as const, data: contact }));
    const insertIfAbsent = vi.fn();
    const setName = vi.fn();
    expect((await ensureContact({ companyId, phone: "4155552671", profileName: null }, { findByPhone, insertIfAbsent, setName })).success).toBe(false);
    expect(findByPhone).not.toHaveBeenCalled();
    await ensureContact({ companyId, phone: "+14155552671", profileName: "   " }, { findByPhone, insertIfAbsent, setName });
    expect(insertIfAbsent).not.toHaveBeenCalled();
    expect(setName).not.toHaveBeenCalled();
  });

  it("updates only when a nonempty received profile name exists", async () => {
    const findByPhone = vi.fn(async () => ({ success: true as const, data: contact }));
    const setName = vi.fn(async (_companyId, _contactId, name) => ({ success: true as const, data: { ...contact, name } }));
    const repository = { findByPhone, insertIfAbsent: vi.fn(), setName };
    expect(await ensureContact({ companyId, phone: contact.phone, profileName: "Ada" }, repository)).toMatchObject({ success: true, data: { id: contact.id, name: "Ada" } });
    expect(setName).toHaveBeenCalledWith(companyId, contact.id, "Ada");
    await ensureContact({ companyId, phone: contact.phone, profileName: null }, repository);
    expect(setName).toHaveBeenCalledTimes(1);
  });
});
