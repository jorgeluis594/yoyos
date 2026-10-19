import { afterEach, expect, test, vi } from "vitest";
import type { ActionFunctionArgs, ClientActionFunctionArgs } from "react-router";
import { action, clientAction } from "@core/app/routes/catalog-settings";
import { catalogSettings } from "@core/src/features/catalog";

const access = { company: { id: "00000000-0000-4000-8000-000000000001" }, user: { id: "00000000-0000-4000-8000-000000000002" } };
const context = { get: () => access } as unknown as ActionFunctionArgs["context"];
function save(fields: Record<string, string>) {
  const request = new Request("http://localhost/es-PE/settings/catalog", { method: "POST", body: new URLSearchParams(fields) });
  return action({ context, request } as ActionFunctionArgs);
}
afterEach(() => vi.restoreAllMocks());

test("catalog settings action rejects a malformed published value instead of hiding", async () => {
  const write = vi.spyOn(catalogSettings, "setPublication").mockResolvedValue({ success: true, data: { published: false } });
  for (const fields of [{}, { published: "1" }, { published: "" }] as Record<string, string>[]) {
    expect(await save(fields)).toMatchObject({ init: { status: 400 } });
  }
  expect(write).not.toHaveBeenCalled();
  expect(await save({ published: "false" })).toEqual({ published: false });
  expect(write).toHaveBeenCalledWith(false, { companyId: access.company.id, userId: access.user.id });
});

test("catalog settings client action turns a lost request into a save error", async () => {
  const serverAction = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
  expect(await clientAction({ serverAction } as unknown as ClientActionFunctionArgs)).toEqual({ error: true });
});
