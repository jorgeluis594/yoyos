import { err, ok } from "@shared/functional";
import { createQuotationApi } from "@mobile/features/delivery-settings/infrastructure/quotation-api";

const id = "00000000-0000-4000-8000-000000000001";
const rate = { id: "00000000-0000-4000-8000-000000000002", method: "home", label: "Entrega a domicilio", price: { amount: 8, currency: "PEN" } };
const quotation = { id, destination: { country: "PE", districtCode: "150122", address: null, instructions: null },
  createdAt: "2026-10-08T00:00:00.000Z", rates: [rate] };

test("seller lookup sends only a district and preserves every option, equal prices and explicit zero", async () => {
  const rates = [rate, { ...rate, id: "00000000-0000-4000-8000-000000000003" },
    { ...rate, id: "00000000-0000-4000-8000-000000000004", method: "agency", label: "Retiro en agencia", price: { amount: 0, currency: "PEN" } }];
  const request = jest.fn(async () => ok({ ...quotation, rates }));
  expect(await createQuotationApi(request)("150122")).toEqual(ok({ id, districtCode: "150122",
    rates: rates.map(({ id, method, price }) => ({ id, method, price })) }));
  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith("/api/quotations", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ destination: { country: "PE", districtCode: "150122" } }) });
  expect(await createQuotationApi(async () => ok({ ...quotation, rates: [] }))("150122"))
    .toEqual(ok({ id, districtCode: "150122", rates: [] }));
});

test("invalid districts do not request a quotation and corrupt or unrelated responses remain failures", async () => {
  const request = jest.fn(async () => ok(quotation));
  for (const district of ["", "000000", "Miraflores", "150122 "])
    expect(await createQuotationApi(request)(district)).toMatchObject({ error: { code: "INVALID_INPUT" } });
  expect(request).not.toHaveBeenCalled();
  for (const response of [{ ...quotation, destination: { ...quotation.destination, districtCode: "040110" } },
    { ...quotation, rates: [rate, rate] }, { ...quotation, unexpected: true },
    ...[-1, 0.001, Infinity].map(amount => ({ ...quotation, rates: [{ ...rate, price: { amount, currency: "PEN" } }] })),
    { ...quotation, rates: [{ ...rate, price: { amount: 8, currency: "USD" } }] },
    { ...quotation, rates: [{ ...rate, method: "store" }] }]) {
    expect(await createQuotationApi(async () => ok(response))("150122")).toMatchObject({ error: { code: "INVALID_RESPONSE" } });
  }
});

test("validates error code and HTTP status, keeps field details and never retries transport failures", async () => {
  const invalid = { code: "INVALID_DISTRICT", error: "Unknown district", districtCode: "150122" };
  expect(await createQuotationApi(async () => err({ code: "API_ERROR", message: "Failed", http: { status: 422, body: invalid } }))("150122"))
    .toEqual(err({ code: "INVALID_DISTRICT", message: "Unknown district", districtCode: "150122" }));
  for (const [status, body] of [[400, invalid], [404, { code: "CHECKOUT_UNAVAILABLE", error: "Unavailable" }],
    [422, { code: "ORDER_CANCELLED", error: "Cancelled" }], [503, {}]] as const) {
    expect(await createQuotationApi(async () => err({ code: "API_ERROR", message: "Failed", http: { status, body } }))("150122"))
      .toMatchObject({ error: { code: "INVALID_RESPONSE" } });
  }
  for (const [status, code] of [[413, "PAYLOAD_TOO_LARGE"], [415, "UNSUPPORTED_MEDIA_TYPE"], [503, "SERVICE_UNAVAILABLE"], [500, "INTERNAL_ERROR"]] as const) {
    expect(await createQuotationApi(async () => err({ code: "API_ERROR", message: "Failed", http: { status, body: { code, error: "Failed" } } }))("150122"))
      .toMatchObject({ error: { code: code === "INTERNAL_ERROR" ? "SERVER_ERROR" : code } });
  }
  const request = jest.fn(async () => err({ code: "NETWORK_ERROR" as const, message: "Lost response" }));
  expect(await createQuotationApi(request)("150122")).toEqual(err({ code: "NETWORK_ERROR", message: "Lost response" }));
  expect(request).toHaveBeenCalledTimes(1);
});
