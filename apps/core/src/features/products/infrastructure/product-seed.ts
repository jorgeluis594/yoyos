import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { ok } from "@shared/functional";
import { prisma, withinTransaction } from "@core/src/shared/infrastructure/persistance";
import { combinationKey } from "@core/src/features/products/domain/product-structure";
import type { OptionId, OptionValueId } from "@core/src/features/products/domain/product";

/** Test and seed helper. Writes directly through Prisma, so call it inside withTenantIsolation. */
export type SeedOption = Readonly<{ name: string; values: readonly string[] }>;
export type SeedVariant = Readonly<{
  id?: string;
  /** Option name to value name. Needs one entry per option of the product. */
  attributes?: Readonly<Record<string, string>>;
  sku?: string | null;
  salePrice?: number;
  purchasePrice?: number | null;
  stock?: number | bigint;
  status?: "active" | "inactive";
  qrCode?: string;
}>;
export type SeedProduct = Readonly<{
  id?: string;
  name?: string;
  description?: string | null;
  imageId?: string | null;
  currency?: string;
  qrCode?: string;
  status?: string;
  createdAt?: Date;
  updatedAt?: Date;
  structureVersion?: number;
  /** Ordered options. Without it, they come from the keys of the variants' attributes, values in order of first appearance. */
  options?: readonly SeedOption[];
  /** Without variants the product gets one active variant without options. */
  variants?: readonly SeedVariant[];
}>;
export type SeededProduct = Readonly<{
  productId: string;
  variantIds: readonly string[];
  optionIds: Readonly<Record<string, string>>;
  valueIds: Readonly<Record<string, Readonly<Record<string, string>>>>;
}>;

function inferOptions(variants: readonly SeedVariant[]): SeedOption[] {
  const options = new Map<string, string[]>();
  for (const variant of variants) {
    for (const [name, value] of Object.entries(variant.attributes ?? {})) {
      const values = options.get(name) ?? [];
      if (!values.includes(value)) values.push(value);
      options.set(name, values);
    }
  }
  return [...options].map(([name, values]) => ({ name, values }));
}

const decimal = (amount: number) => new Prisma.Decimal(amount.toString());

export async function seedProduct(input: SeedProduct = {}): Promise<SeededProduct> {
  const variants = input.variants?.length ? input.variants : [{}];
  const options = input.options ?? inferOptions(variants);
  const productId = input.id ?? randomUUID();
  const now = new Date();
  const optionIds: Record<string, string> = {};
  const valueIds: Record<string, Record<string, string>> = {};
  for (const option of options) {
    optionIds[option.name] = randomUUID();
    valueIds[option.name] = Object.fromEntries(option.values.map((value) => [value, randomUUID()]));
  }
  const variantIds = variants.map((variant) => variant.id ?? randomUUID());

  const result = await withinTransaction(async () => {
    await prisma.product.create({ data: {
      id: productId, name: input.name ?? "Sample product", description: input.description ?? null, imageId: input.imageId ?? null,
      currency: input.currency ?? "PEN", qrCode: input.qrCode ?? randomUUID(), status: input.status ?? "active",
      createdAt: input.createdAt ?? now, updatedAt: input.updatedAt ?? now, structureVersion: input.structureVersion ?? 1,
    } });
    if (options.length) {
      await prisma.productOption.createMany({ data: options.map((option, position) => ({ id: optionIds[option.name], productId, name: option.name, position })) });
      await prisma.productOptionValue.createMany({ data: options.flatMap((option) => option.values.map((value, position) => ({
        id: valueIds[option.name][value], optionId: optionIds[option.name], productId, name: value, position }))) });
    }
    const links: { productId: string; variantId: string; optionId: string; valueId: string }[] = [];
    const rows = variants.map((variant, index) => {
      const combination: Record<OptionId, OptionValueId> = {};
      for (const option of options) {
        const value = variant.attributes?.[option.name];
        const valueId = value === undefined ? undefined : valueIds[option.name][value];
        if (valueId === undefined) throw new Error(`Seeded variant ${index} has no value of option ${option.name}`);
        combination[optionIds[option.name] as OptionId] = valueId as OptionValueId;
        links.push({ productId, variantId: variantIds[index], optionId: optionIds[option.name], valueId });
      }
      return { id: variantIds[index], productId, combinationKey: combinationKey(combination), sku: variant.sku ?? null,
        salePrice: decimal(variant.salePrice ?? 10), purchasePrice: variant.purchasePrice == null ? null : decimal(variant.purchasePrice),
        qrCode: variant.qrCode ?? randomUUID(), status: variant.status ?? "active" };
    });
    await prisma.productVariant.createMany({ data: rows });
    await prisma.productStock.createMany({ data: variants.map((variant, index) => ({ variantId: variantIds[index], quantity: BigInt(variant.stock ?? 0) })) });
    if (links.length) await prisma.productVariantOptionValue.createMany({ data: links });
    return ok(null);
  });
  if (!result.success) throw new Error("Unable to seed product");
  return { productId, variantIds, optionIds, valueIds };
}

/** Removes every product of the current tenant with its stock, options and values. Orders that reference variants must be removed first. */
export async function deleteSeededProducts(): Promise<void> {
  await prisma.productStock.deleteMany({});
  await prisma.productVariant.deleteMany({});
  await prisma.productOption.deleteMany({});
  await prisma.product.deleteMany({});
}
