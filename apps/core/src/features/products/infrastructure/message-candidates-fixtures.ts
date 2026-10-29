import { randomUUID } from "node:crypto";
import { ok } from "@shared/functional";
import { prisma, withinTransaction } from "@core/src/shared/infrastructure/persistance";
import { combinationKey } from "@core/src/features/products/domain/product-structure";

/** Test and benchmark support. Realistic store names built from type, connector, feature, color and style. */
const types = ["Polera", "Polo", "Casaca", "Pantalón", "Short", "Falda", "Vestido", "Gorra", "Zapatilla", "Mochila", "Chompa", "Blusa"];
const connectors = ["con", "para", "de", "sin"];
const features = ["capucha", "bolsillos", "cierre", "botones", "cuello alto", "estampado", "rayas", "cinturón", "encaje", "mangas largas", "correa"];
const colors = ["negro", "blanco", "rojo", "azul", "verde", "gris", "beige", "rosado", "mostaza", "celeste"];
const styles = ["slim", "clásico", "deportivo", "casual", "elegante", "básico", "juvenil", "vintage", "premium", "ligero"];

/** Deterministic names, none of them containing «oversize» or «edición limitada», so benchmark targets stay unique. */
export function catalogNames(count: number, shape: "mixed" | "shared" = "mixed"): string[] {
  return Array.from({ length: count }, (_, index) => {
    const type = shape === "shared" ? "Polera" : types[index % types.length]!;
    const feature = features[Math.floor(index / types.length) % features.length]!;
    const color = colors[Math.floor(index / (types.length * features.length)) % colors.length]!;
    const style = styles[Math.floor(index / (types.length * features.length * colors.length)) % styles.length]!;
    const connector = connectors[(index * 7) % connectors.length]!;
    const serial = Math.floor(index / (types.length * features.length * colors.length * styles.length));
    return `${type} ${connector} ${feature} ${color} ${style}${serial ? ` ${serial}` : ""}`;
  });
}

/** Inserts active products with one active variant each, in chunks. Call inside withTenantIsolation. */
export async function insertProductNames(names: readonly string[]): Promise<string[]> {
  const ids: string[] = [];
  const now = new Date();
  for (let from = 0; from < names.length; from += 2_000) {
    const chunk = names.slice(from, from + 2_000).map((name) => ({ id: randomUUID(), name }));
    ids.push(...chunk.map(({ id }) => id));
    const result = await withinTransaction(async () => {
      await prisma.product.createMany({ data: chunk.map(({ id, name }) => ({ id, name, currency: "PEN", qrCode: id, status: "active", createdAt: now, updatedAt: now, structureVersion: 1 })) });
      await prisma.productVariant.createMany({ data: chunk.map(({ id }) => ({ id: randomUUID(), productId: id, combinationKey: combinationKey({}), salePrice: 10, qrCode: randomUUID(), status: "active" })) });
      return ok(null);
    });
    if (!result.success) throw new Error("Unable to insert products");
  }
  return ids;
}
