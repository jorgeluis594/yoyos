import * as Crypto from "expo-crypto";
import { generateProduct } from "./generate-product";
import type { ProductInput } from "../domain/product";

jest.mock("expo-crypto", () => ({ randomUUID: jest.fn() }));

const randomUUID = Crypto.randomUUID as jest.Mock;

const input = (): ProductInput => ({
  name: "Shirt",
  currency: "PEN",
  variants: [
    { id: "variant-1", sku: "SHIRT-RED", attributes: { color: "Red" }, salePrice: 25.9, purchasePrice: 10, initialQuantity: 3 },
    { sku: "SHIRT-BLUE", attributes: { color: "Blue" }, salePrice: 26 },
  ],
});

beforeEach(() => {
  randomUUID.mockReset();
  let next = 0;
  randomUUID.mockImplementation(() => `uuid-${++next}`);
});

test("preserves supplied IDs and builds variants, prices, QR codes and stock", () => {
  const result = generateProduct({ ...input(), id: "product-1" });
  expect(result.success).toBe(true);
  if (!result.success) return;
  expect(result.data).toMatchObject({
    id: "product-1", status: "active", qrCode: "uuid-4",
    variants: [
      { id: "variant-1", productId: "product-1", qrCode: "uuid-1", salePrice: { amount: 25.9, currency: "PEN" }, purchasePrice: { amount: 10, currency: "PEN" }, status: "active" },
      { id: "uuid-2", productId: "product-1", qrCode: "uuid-3", salePrice: { amount: 26, currency: "PEN" }, status: "active" },
    ],
    stocks: [{ variantId: "variant-1", quantity: 3 }, { variantId: "uuid-2", quantity: 0 }],
  });
  expect(result.data.variants[1]).not.toHaveProperty("purchasePrice");
});

test("generates a missing product ID", () => {
  const result = generateProduct(input());
  expect(result.success).toBe(true);
  if (result.success) expect(result.data.id).toBe("uuid-1");
});

test.each([
  ["no variants", (value: ProductInput) => { value.variants = []; }, "INVALID_PRODUCT"],
  ["empty name", (value: ProductInput) => { value.name = " "; }, "INVALID_PRODUCT"],
  ["empty SKU", (value: ProductInput) => { value.variants[0].sku = " "; }, "INVALID_VARIANT"],
  ["duplicate SKU", (value: ProductInput) => { value.variants[1].sku = " shirt-red "; }, "DUPLICATE_SKU"],
  ["duplicate attributes", (value: ProductInput) => { value.variants[1].attributes = { color: " red " }; }, "DUPLICATE_ATTRIBUTES"],
  ["zero sale price", (value: ProductInput) => { value.variants[0].salePrice = 0; }, "INVALID_PRICE"],
  ["negative purchase price", (value: ProductInput) => { value.variants[0].purchasePrice = -1; }, "INVALID_PRICE"],
  ["fractional cents", (value: ProductInput) => { value.variants[0].salePrice = 1.001; }, "INVALID_PRICE"],
  ["invalid currency", (value: ProductInput) => { value.currency = "BAD"; }, "INVALID_PRODUCT"],
  ["negative stock", (value: ProductInput) => { value.variants[0].initialQuantity = -1; }, "INVALID_STOCK"],
  ["fractional stock", (value: ProductInput) => { value.variants[0].initialQuantity = 1.5; }, "INVALID_STOCK"],
])("rejects %s without generating IDs", (_label, change, code) => {
  const value = input();
  change(value);
  expect(generateProduct(value)).toMatchObject({ success: false, error: { code } });
  expect(randomUUID).not.toHaveBeenCalled();
});
