import { expect, test } from "vitest";
import { parseExpoPushToken } from "@core/src/features/notifications/domain/push-device";

test("accepts Expo push tokens and rejects other strings", () => {
  expect(parseExpoPushToken("ExponentPushToken[abc-123_XYZ]")).toMatchObject({ success: true, data: "ExponentPushToken[abc-123_XYZ]" });
  expect(parseExpoPushToken("ExpoPushToken[abc]")).toMatchObject({ success: true });
  for (const value of ["", "abc", "ExponentPushToken[]", "ExponentPushToken[a]b", "FCM:token", " ExponentPushToken[a]"])
    expect(parseExpoPushToken(value)).toMatchObject({ success: false, error: { code: "INVALID_PUSH_TOKEN" } });
});
