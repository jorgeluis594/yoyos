import { parseAccountId, parseChatId, parseDeliveryId, parseImageReference, parseNativeMessageId } from "@mobile/features/whatsapp/domain/ids";

test("parseLid accepts <n>@lid and rejects phone JIDs, empty values and other suffixes", () => {
  for (const parse of [parseAccountId, parseChatId]) {
    expect(parse("123@lid")).toEqual({ success: true, data: "123@lid" });
    for (const value of ["123@s.whatsapp.net", "", "@lid", "abc@lid", "123@lid.x", "123@g.us"])
      expect(parse(value)).toMatchObject({ success: false, error: { code: "INVALID_ID" } });
  }
  expect(parseAccountId("x", "accountId")).toMatchObject({ error: { field: "accountId" } });
});

test("native message, delivery and image ids are accepted only with their versioned prefix", () => {
  expect(parseNativeMessageId("wa-message:v1:WyIxQGxpZCJd")).toMatchObject({ success: true });
  expect(parseNativeMessageId("wa-message:v2:abc")).toMatchObject({ success: false });
  expect(parseNativeMessageId("wa-message:v1:")).toMatchObject({ success: false });
  expect(parseDeliveryId(`wa-delivery:v1:${"a".repeat(32)}`)).toMatchObject({ success: true });
  expect(parseDeliveryId(`wa-delivery:v1:${"a".repeat(31)}`)).toMatchObject({ success: false });
  expect(parseDeliveryId(`delivery:${"a".repeat(32)}`)).toMatchObject({ success: false });
  expect(parseImageReference("wa-image:v1:abc")).toMatchObject({ success: true });
  expect(parseImageReference("wa-image:v1:")).toMatchObject({ success: false });
  expect(parseImageReference("abc")).toMatchObject({ success: false });
});
