import { describe, expect, test } from "vitest";
import { catalogPaymentOptions, offeredChoiceName, offeredChoiceOf, offeredPayment, paymentOptionsOf } from "@core/src/features/orders/presentation/payment-options";

const qr = { status: "verified" as const, imageId: "8b0f2c55-5f3a-4b6a-9d5e-2a8f6f1c3b11" };
const wallet = (provider: string) => ({ method: "digital_wallet" as const, provider, holder: "Ana", qr });
const bank = { method: "bank_transfer" as const, bank: "BCP", holder: "Ana", accountNumber: "123", cci: null, imageId: null };
const texts = { wallet: "Billetera digital", bankTransfer: "Transferencia bancaria" };

describe("payment options of the company settings", () => {
  test("a sale offers only the wallet and bank transfer the settings enable", () => {
    expect(paymentOptionsOf([wallet("Yape"), bank]).choices).toEqual(["yape", "bank_transfer"]);
    expect(paymentOptionsOf([bank]).choices).toEqual(["bank_transfer"]);
    expect(paymentOptionsOf([wallet("Plin")]).choices).toEqual(["plin"]);
  });

  test("a wallet name of the catalog becomes its provider whatever its case, accents or spaces", () => {
    expect(paymentOptionsOf([wallet("  YAPÉ ")]).choices).toEqual(["yape"]);
  });

  test("a wallet name outside the catalog is offered as the company's own wallet under that name", () => {
    const options = paymentOptionsOf([wallet(" Lukita ")]);
    expect(options.choices).toEqual(["digital_wallet"]);
    expect(offeredChoiceName("digital_wallet", options, texts)).toBe("Lukita");
    expect(offeredPayment("digital_wallet")).toEqual({ method: "digital_wallet" });
  });

  test("without any method enabled the sale offers the whole catalog and points to the settings", () => {
    expect(paymentOptionsOf([])).toEqual({ ...catalogPaymentOptions, unconfigured: true });
    expect(catalogPaymentOptions.choices).toEqual(["yape", "plin", "bank_transfer"]);
  });

  test("a draft maps back to the choice it was made from", () => {
    for (const choice of ["yape", "plin", "digital_wallet", "bank_transfer"] as const) expect(offeredChoiceOf(offeredPayment(choice))).toBe(choice);
  });
});
