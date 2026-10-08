import { expect, test, vi } from "vitest";
import { requestDeliveryQuotation } from "@core/src/features/delivery-settings/infrastructure/quotation-api";

const id = "00000000-0000-4000-8000-000000000001";
const option = { id, method: "home", label: "Entrega a domicilio", price: { amount: 8, currency: "PEN" } };
const quote = { id, createdAt: "2026-10-07T00:00:00Z", destination: { country: "PE", districtCode: "150122", address: null, instructions: null }, rates: [option] };
const response = (body: unknown, status = 201) => new Response(JSON.stringify(body), { status });

test("buyer quotations send only order-link authority and the selected district, preserving every rate", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ ...quote, rates: [option, { ...option, id: "00000000-0000-4000-8000-000000000002" }] }));
  const result = await requestDeliveryQuotation({ districtCode: "150122", orderId: id }, undefined, fetcher);
  expect(result).toMatchObject({ success: true, data: { rates: [option, expect.objectContaining({ price: option.price })] } });
  expect(fetcher).toHaveBeenCalledWith("/api/quotations", expect.objectContaining({ method: "POST", credentials: "same-origin", cache: "no-store",
    body: JSON.stringify({ orderId: id, destination: { country: "PE", districtCode: "150122" } }) }));
});

test("empty rates are success, while malformed, unrelated and duplicated responses are failures", async () => {
  const fetcher = vi.fn<typeof fetch>();
  fetcher.mockResolvedValue(response({ ...quote, rates: [] }));
  expect(await requestDeliveryQuotation({ districtCode: "150122" }, undefined, fetcher)).toMatchObject({ success: true, data: { rates: [] } });
  for (const body of [{}, { ...quote, destination: { ...quote.destination, districtCode: "150101" } }, { ...quote, rates: [option, option] },
    { ...quote, rates: [{ ...option, price: { amount: 8, currency: "USD" } }] }]) {
    fetcher.mockResolvedValue(response(body));
    expect(await requestDeliveryQuotation({ districtCode: "150122" }, undefined, fetcher)).toMatchObject({ error: { code: "INVALID_RESPONSE" } });
  }
});

test("request cancellation rejects late success even when the transport ignores abort", async () => {
  const controller = new AbortController();
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
    expect(init?.signal).toBe(controller.signal);
    controller.abort();
    return response(quote);
  });
  expect(await requestDeliveryQuotation({ districtCode: "150122" }, controller.signal, fetcher)).toMatchObject({ error: { code: "CANCELLED" } });
  fetcher.mockClear();
  expect(await requestDeliveryQuotation({ districtCode: "150122" }, controller.signal, fetcher)).toMatchObject({ error: { code: "CANCELLED" } });
  expect(fetcher).not.toHaveBeenCalled();
});

test("invalid input never reaches the server and errors never become free delivery", async () => {
  const fetcher = vi.fn<typeof fetch>();
  expect(await requestDeliveryQuotation({ districtCode: "000000" }, undefined, fetcher)).toMatchObject({ error: { code: "INVALID_DISTRICT" } });
  expect(await requestDeliveryQuotation({ districtCode: "150122", orderId: "invalid" }, undefined, fetcher)).toMatchObject({ error: { code: "INVALID_INPUT" } });
  expect(fetcher).not.toHaveBeenCalled();
  for (const [code, status] of [["CHECKOUT_UNAVAILABLE", 404], ["ORDER_CANCELLED", 422], ["SERVICE_UNAVAILABLE", 503]] as const) {
    fetcher.mockResolvedValue(response({ code, error: "Private detail" }, status));
    expect(await requestDeliveryQuotation({ districtCode: "150122" }, undefined, fetcher)).toEqual({ success: false, error: { code, message: "Unable to load delivery options" } });
  }
  fetcher.mockResolvedValue(response({ code: "SERVICE_UNAVAILABLE", error: "Private detail" }, 422));
  expect(await requestDeliveryQuotation({ districtCode: "150122" }, undefined, fetcher)).toMatchObject({ error: { code: "INVALID_RESPONSE" } });
  fetcher.mockRejectedValue(new Error("Private network detail"));
  expect(await requestDeliveryQuotation({ districtCode: "150122" }, undefined, fetcher)).toMatchObject({ error: { code: "REQUEST_FAILED" } });
});

test("cancellation during response decoding and malformed JSON cannot supply options", async () => {
  const controller = new AbortController();
  const received = response(quote);
  vi.spyOn(received, "json").mockImplementation(async () => { controller.abort(); return quote; });
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(received);
  expect(await requestDeliveryQuotation({ districtCode: "150122" }, controller.signal, fetcher)).toMatchObject({ error: { code: "CANCELLED" } });
  fetcher.mockResolvedValue(new Response("not JSON", { status: 201 }));
  expect(await requestDeliveryQuotation({ districtCode: "150122" }, undefined, fetcher)).toMatchObject({ error: { code: "INVALID_RESPONSE" } });
});
