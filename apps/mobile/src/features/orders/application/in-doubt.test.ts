import { err, ok } from "@shared/functional";
import { isLostAnswer, repeatWhileInDoubt } from "@mobile/features/orders/application/in-doubt";

const lost = () => err({ code: "NETWORK_ERROR" as const, message: "down" });

test("an answer that may have been lost is repeated until it is definite, announcing the doubt once", async () => {
  const attempt = jest.fn().mockResolvedValueOnce(lost()).mockResolvedValueOnce(lost()).mockResolvedValueOnce(ok("saved"));
  const onInDoubt = jest.fn();
  const waits: number[] = [];
  const result = await repeatWhileInDoubt(attempt, { onInDoubt, wait: async (ms) => { waits.push(ms); }, delays: [0, 50] });
  expect(result).toEqual(ok("saved"));
  expect(attempt).toHaveBeenCalledTimes(3);
  expect(onInDoubt).toHaveBeenCalledTimes(1);
  expect(waits).toEqual([0, 50]);
});

test("a refusal is definite and is never repeated", async () => {
  const attempt = jest.fn().mockResolvedValue(err({ code: "ORDER_CHANGED" as const, message: "changed" }));
  const onInDoubt = jest.fn();
  expect(await repeatWhileInDoubt(attempt, { onInDoubt, wait: async () => undefined, delays: [0, 0] })).toMatchObject({ error: { code: "ORDER_CHANGED" } });
  expect(attempt).toHaveBeenCalledTimes(1);
  expect(onInDoubt).not.toHaveBeenCalled();
});

test("when every repeat is lost the last error comes back for the caller to read as not sent", async () => {
  const attempt = jest.fn().mockResolvedValue(lost());
  const result = await repeatWhileInDoubt(attempt, { onInDoubt: jest.fn(), wait: async () => undefined, delays: [0, 0] });
  expect(attempt).toHaveBeenCalledTimes(3);
  expect(!result.success && isLostAnswer(result.error.code)).toBe(true);
  expect(isLostAnswer("SERVICE_UNAVAILABLE")).toBe(false);
});
