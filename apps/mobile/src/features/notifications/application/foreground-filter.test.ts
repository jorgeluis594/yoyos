import { createFakeStore } from "./fakes";
import { decideForegroundNotice } from "./foreground-filter";

const company = "6f1d5c1e-5b0b-4c53-9a53-0d6a0b3b2a11";
const other = "0b1f2a43-9f3c-4f0e-8d0b-6f1a2b3c4d5e";
const data = (companyId: string) => ({ v: 1, companyId, messageId: "7c9e6679-7425-40de-944b-e07fc1f90ae7", target: "message" });
const registration = { fingerprint: "f", token: "ExponentPushToken[abc]" };

test("shows a foreground notice of the signed-in company", async () => {
  const { store, state } = createFakeStore({ registration });
  expect(await decideForegroundNotice(data(company), { companyId: company }, store)).toBe("show");
  expect(state.pending).toBeNull();
});

test("does not show a foreground notice of another company and queues an unregister", async () => {
  const { store, state } = createFakeStore({ registration });
  expect(await decideForegroundNotice(data(other), { companyId: company }, store)).toBe("hide");
  expect(state.pending).toBe("ExponentPushToken[abc]");
});

test("does not show a notice while signed out or one that is not a seller notice", async () => {
  const { store } = createFakeStore();
  expect(await decideForegroundNotice(data(company), null, store)).toBe("hide");
  expect(await decideForegroundNotice({ hello: "world" }, { companyId: company }, store)).toBe("hide");
});
