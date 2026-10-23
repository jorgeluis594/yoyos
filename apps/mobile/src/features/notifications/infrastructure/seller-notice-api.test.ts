import { err, ok } from "@shared/functional";
import { createSellerNoticeApi } from "./seller-notice-api";

const messageId = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const orderId = "9d3b1f7a-1c52-4c2e-bb0f-2f5d2f3b8a10";

test("resolves the order of a notice through the contract", async () => {
  const request = jest.fn(async () => ok({ version: 1, target: { kind: "order", orderId } }));
  expect(await createSellerNoticeApi(request).resolveOrder(messageId)).toEqual(ok(orderId));
  expect(request).toHaveBeenCalledWith(`/api/seller-notices/${messageId}`);
});

test("fails when core cannot answer, does not know the notice or answers a message target", async () => {
  const request = jest.fn();
  const api = createSellerNoticeApi(request);
  request.mockResolvedValueOnce(err({ code: "NOT_FOUND", message: "missing" }));
  expect(await api.resolveOrder(messageId)).toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
  request.mockResolvedValueOnce(ok({ version: 1, target: { kind: "message" } }));
  expect(await api.resolveOrder(messageId)).toMatchObject({ success: false, error: { code: "INVALID_RESPONSE" } });
  request.mockResolvedValueOnce(ok({ version: 2 }));
  expect(await api.resolveOrder(messageId)).toMatchObject({ success: false, error: { code: "INVALID_RESPONSE" } });
});
