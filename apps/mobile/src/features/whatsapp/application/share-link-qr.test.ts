import { ok } from "@shared/functional";
import type { ReceptionStatus } from "@mobile/features/whatsapp/application/reception-lifecycle";
import { shareLinkQrChanges } from "@mobile/features/whatsapp/application/share-link-qr";

const base: ReceptionStatus = { connection: "connecting", qr: null, notice: null, lastError: null };

function setup() {
  let emit: (status: ReceptionStatus) => void = () => undefined;
  const share = jest.fn(async () => ok(undefined));
  shareLinkQrChanges({ subscribe: (listener) => { emit = listener; return () => undefined; }, share });
  return { emit: (status: ReceptionStatus) => emit(status), share };
}

test("shares each new QR once and its removal", () => {
  const { emit, share } = setup();
  const qr = { value: "2@abc", expiresAt: 1_000 };
  emit({ ...base, qr });
  emit({ ...base, qr, connection: "reconnecting" });
  emit({ ...base, qr: { value: "2@def", expiresAt: 2_000 } });
  emit({ ...base, connection: "connected", qr: null });
  expect(share.mock.calls).toEqual([[qr], [{ value: "2@def", expiresAt: 2_000 }], [null]]);
});

test("does not send anything while no QR was ever shown", () => {
  const { emit, share } = setup();
  emit({ ...base, connection: "connected" });
  expect(share).not.toHaveBeenCalled();
});
