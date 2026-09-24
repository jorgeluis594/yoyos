import { Prisma, type Product as DbProduct, type ProductVariant as DbVariant, type ProductStock as DbStock } from "@prisma/client";
import { err, ok } from "@shared/functional";
import { prisma, withinTransaction, getCompanyId } from "@core/src/shared/infrastructure/persistance";
import type { ProductRepository } from "@core/src/features/products/application/repository";
import type { CompanyId, ImageId, Product, ProductId, ProductVariant, VariantId } from "@core/src/features/products/domain/product";

type DbAggregate = DbProduct & { variants: (DbVariant & { stock: DbStock | null })[] };

function mapProduct(row: DbAggregate): Product {
  if (!row.variants.length) throw new Error("Stored product has no variants");
  const variants = row.variants.map((variant): ProductVariant => {
    if (!variant.stock) throw new Error("Stored variant has no stock");
    if (variant.stock.quantity > BigInt(Number.MAX_SAFE_INTEGER) || variant.stock.quantity < 0n) throw new Error("Stored stock is outside the supported range");
    const attributes = variant.attributes;
    if (!attributes || typeof attributes !== "object" || Array.isArray(attributes) || Object.values(attributes).some((value) => typeof value !== "string")) throw new Error("Stored variant has invalid attributes");
    return {
      id: variant.id as VariantId, productId: row.id as ProductId,
      attributes: { ...attributes } as Record<string, string>,
      ...(variant.sku === null ? {} : { sku: variant.sku }),
      salePrice: { amount: variant.salePrice.toNumber(), currency: row.currency },
      ...(variant.purchasePrice === null ? {} : { purchasePrice: { amount: variant.purchasePrice.toNumber(), currency: row.currency } }),
      qrCode: variant.qrCode, status: variant.status as "active",
      stock: { variantId: variant.stock.variantId as VariantId, quantity: Number(variant.stock.quantity) },
    };
  }) as [ProductVariant, ...ProductVariant[]];
  return {
    id: row.id as ProductId, companyId: row.companyId as CompanyId, name: row.name,
    ...(row.description === null ? {} : { description: row.description }),
    ...(row.imageId === null ? {} : { imageId: row.imageId as ImageId }),
    currency: row.currency as Product["currency"], qrCode: row.qrCode, status: row.status as "active",
    createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt), variants,
  };
}

export const productRepository: ProductRepository = {
  async create(companyId, product) {
    if (getCompanyId() !== companyId || product.companyId !== companyId) throw new Error("Company context mismatch");
    try {
      return await withinTransaction(async () => {
        await prisma.product.create({ data: {
          id: product.id, companyId, name: product.name, description: product.description,
          imageId: product.imageId, currency: product.currency, qrCode: product.qrCode,
          status: product.status, createdAt: product.createdAt, updatedAt: product.updatedAt,
        } });
        for (const variant of product.variants) {
          await prisma.productVariant.create({ data: {
            id: variant.id, companyId, productId: variant.productId, attributes: variant.attributes as Prisma.InputJsonObject,
            sku: variant.sku, salePrice: new Prisma.Decimal(variant.salePrice.amount.toString()),
            purchasePrice: variant.purchasePrice === undefined ? null : new Prisma.Decimal(variant.purchasePrice.amount.toString()),
            qrCode: variant.qrCode, status: variant.status,
          } });
          await prisma.productStock.create({ data: { variantId: variant.stock.variantId, companyId, quantity: BigInt(variant.stock.quantity) } });
        }
        return ok(product.id);
      });
    } catch (error) {
      const adapter = error instanceof Prisma.PrismaClientKnownRequestError
        ? error.meta?.driverAdapterError as { cause?: { constraint?: { index?: string } } } | undefined
        : undefined;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && adapter?.cause?.constraint?.index === "ProductVariant_companyId_sku_normalized_key") {
        return err({ code: "DUPLICATE_SKU", message: "SKU is already used" });
      }
      throw error;
    }
  },
  async get(companyId, id) {
    if (getCompanyId() !== companyId) throw new Error("Company context mismatch");
    const row = await prisma.product.findFirst({ where: { companyId, id }, include: { variants: { include: { stock: true }, orderBy: { id: "asc" } } } });
    return row ? mapProduct(row) : null;
  },
};
