import { Prisma } from "@prisma/client";

/** The unique index a Prisma `P2002` names. Raw statements report it in the message instead; see `mentions`. */
export function violatedIndex(error: unknown): string | undefined {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return undefined;
  const adapter = error.meta?.driverAdapterError as { cause?: { constraint?: { index?: string } } } | undefined;
  return adapter?.cause?.constraint?.index;
}

/** Whether the error text or its metadata names the constraint. */
export const mentions = (error: unknown, name: string) => {
  let meta = "";
  try { meta = JSON.stringify((error as { meta?: unknown } | null)?.meta ?? {}); } catch { /* the message is enough */ }
  return `${error instanceof Error ? error.message : ""} ${meta}`.includes(name);
};

const violates = (error: unknown, ...names: readonly string[]) => names.some((name) => violatedIndex(error) === name || mentions(error, name));

export const isDuplicateSku = (error: unknown) => violates(error, "ProductVariant_companyId_sku_normalized_key");
export const isDuplicateCombination = (error: unknown) => violates(error, "ProductVariant_companyId_productId_combinationKey_key");
export const isDuplicateOptionId = (error: unknown) => violates(error, "ProductOption_pkey", "ProductOptionValue_pkey");
export const isDuplicateValueId = (error: unknown) => violates(error, "ProductOptionValue_pkey");
export const isDuplicateProductId = (error: unknown) => ["Product_pkey", "Product_id_key"].includes(violatedIndex(error) ?? "");
export const isForeignKeyOfOrders = (error: unknown) => mentions(error, "OrderItem_companyId_variantId_fkey");
export const isForeignKeyViolation = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003";
export const isMissingRow = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";
