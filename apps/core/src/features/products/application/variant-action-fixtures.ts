import type { OptionId, OptionText, OptionValueId, Product, ProductId, ProductVariant, VariantId } from "@core/src/features/products/domain/product";

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
export const productId = id(1) as ProductId;
export const talla = id(10) as OptionId;
export const color = id(11) as OptionId;
export const medium = id(20) as OptionValueId;
export const large = id(21) as OptionValueId;
export const negro = id(22) as OptionValueId;
export const azul = id(23) as OptionValueId;
export const mNegro = id(30) as VariantId;
export const mAzul = id(31) as VariantId;
export const lNegro = id(32) as VariantId;
export const lAzul = id(33) as VariantId;
export const newId = (n: number) => id(100 + n);
export const when = new Date("2026-10-01T00:00:00.000Z");

const text = (value: string) => value as OptionText;

function variant(variantId: VariantId, combination: Record<OptionId, OptionValueId>, stock: number, extra: Partial<ProductVariant> = {}): ProductVariant {
  return { id: variantId, productId, combination, salePrice: { amount: 20, currency: "PEN" }, qrCode: `qr-${variantId}`, status: "active", stock: { variantId, quantity: stock }, ...extra };
}

/** Talla M/L by Color Negro/Azul, four variants without stock unless said otherwise. */
export function shirts(stock: Partial<Record<VariantId, number>> = {}): Product {
  return {
    id: productId, name: "Polo", photoIds: [] as unknown as Product["photoIds"], currency: "PEN", qrCode: "qr-product", status: "active", createdAt: when, updatedAt: when, structureVersion: 3,
    options: [
      { id: talla, name: text("Talla"), values: [{ id: medium, name: text("M") }, { id: large, name: text("L") }] },
      { id: color, name: text("Color"), values: [{ id: negro, name: text("Negro") }, { id: azul, name: text("Azul") }] },
    ],
    variants: [
      variant(mNegro, { [talla]: medium, [color]: negro }, stock[mNegro] ?? 0, { sku: "POLO-MN" }),
      variant(mAzul, { [talla]: medium, [color]: azul }, stock[mAzul] ?? 0),
      variant(lNegro, { [talla]: large, [color]: negro }, stock[lNegro] ?? 0),
      variant(lAzul, { [talla]: large, [color]: azul }, stock[lAzul] ?? 6, { status: "inactive" }),
    ],
  };
}

export function simple(): Product {
  const variantId = id(40) as VariantId;
  return { ...shirts(), options: [], variants: [variant(variantId, {}, 0)] };
}
