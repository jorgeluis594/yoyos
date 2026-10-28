import { prepareProductLabel } from "@mobile/features/products/domain/product-label";
import type { Product, VariantId, VariantQrCode } from "@mobile/features/products/domain/product";

const firstId = "first" as VariantId;
const secondId = "second" as VariantId;
const product: Product = {
  id: "product" as Product["id"], name: "Camisa", currency: "PEN", photos: [], structureVersion: 1, options: [],
  variants: [
    { id: firstId, combination: [], sku: "CAM-S", qrCode: "first-qr" as VariantQrCode, salePrice: { amount: 20, currency: "PEN" }, stock: 1, status: "active", hasOrders: false },
    { id: secondId, combination: [], qrCode: "second-qr" as VariantQrCode, salePrice: { amount: 20, currency: "PEN" }, stock: 1, status: "active", hasOrders: false },
  ],
};

test("prepares only the explicitly chosen variant and preserves its QR", () => {
  expect(prepareProductLabel(product, firstId)).toEqual({ success: true, data: { productName: "Camisa", sku: "CAM-S", qrCode: "first-qr" } });
  expect(prepareProductLabel(product, secondId)).toEqual({ success: true, data: { productName: "Camisa", qrCode: "second-qr" } });
  expect(prepareProductLabel(product, "other" as VariantId)).toMatchObject({ success: false, error: { code: "VARIANT_NOT_FOUND" } });
});

test("label carries the combination below the name and omits it for a simple product", () => {
  const talla = "talla" as never, large = "large" as never, color = "color" as never, blue = "blue" as never;
  const withOptions: Product = { ...product, options: [{ id: talla, name: "Talla", values: [{ id: large, name: "L" }] }, { id: color, name: "Color", values: [{ id: blue, name: "Azul" }] }],
    variants: [{ ...product.variants[0], combination: [{ optionId: talla, valueId: large }, { optionId: color, valueId: blue }] }] };
  expect(prepareProductLabel(withOptions, firstId)).toEqual({ success: true, data: { productName: "Camisa", combination: "L / Azul", sku: "CAM-S", qrCode: "first-qr" } });
  const simple = prepareProductLabel(product, firstId);
  expect(simple.success && "combination" in simple.data).toBe(false);
});
