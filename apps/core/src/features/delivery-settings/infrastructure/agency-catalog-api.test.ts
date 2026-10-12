import { expect, test, vi } from "vitest";
import { readAgencyCatalog } from "@core/src/features/delivery-settings/infrastructure/agency-catalog-api";

const courierId = "00000000-0000-4000-8000-000000000101";
const agency = { id: "00000000-0000-4000-8000-000000000201", courierId, name: "Shalom Miraflores", address: "Av. Larco 1301", enabled: true,
  location: { country: "PE", districtCode: "150122", district: "MIRAFLORES", province: "LIMA METROPOLITANA", department: "LIMA" } };
const reply = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

test("reads the validated agencies of a courier", async () => {
  const fetcher = reply({ agencies: [agency] });
  expect(await readAgencyCatalog(courierId, fetcher)).toEqual({ success: true, data: { agencies: [agency] } });
  expect(fetcher).toHaveBeenCalledWith(`/api/delivery-settings/agency-catalog?courierId=${courierId}`, expect.objectContaining({ credentials: "same-origin" }));
});

test("maps statuses and rejects responses that are foreign, disabled or malformed", async () => {
  expect(await readAgencyCatalog(courierId, reply({}, 404))).toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
  expect(await readAgencyCatalog(courierId, reply({}, 401))).toMatchObject({ success: false, error: { code: "UNAUTHENTICATED" } });
  expect(await readAgencyCatalog(courierId, reply({}, 500))).toMatchObject({ success: false, error: { code: "SERVICE_UNAVAILABLE" } });
  expect(await readAgencyCatalog(courierId, vi.fn(async () => { throw new Error("offline"); }))).toMatchObject({ success: false, error: { code: "SERVICE_UNAVAILABLE" } });
  for (const invalid of [{ ...agency, courierId: "00000000-0000-4000-8000-000000000102" }, { ...agency, enabled: false }, { ...agency, name: "" }])
    expect(await readAgencyCatalog(courierId, reply({ agencies: [invalid] }))).toMatchObject({ success: false, error: { code: "INVALID_RESPONSE" } });
});
