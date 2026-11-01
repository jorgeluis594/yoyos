import { describe, expect, test } from "vitest";
import {
  listUnsoldProducts, otherCurrencySales, rankOneProduct, rankSoldProducts,
  type ProjectableDescribedVariant, type ProjectableSaleDates, type ProjectableSoldVariant, type ProjectableStockedProduct,
} from "@core/src/features/assistants/domain/product-sales-projection";

const pen = (amount: number) => ({ amount, currency: "PEN" as const });
const usd = (amount: number) => ({ amount, currency: "USD" as const });
const sold = (variantId: string, units: number, amount: number, currency: "PEN" | "USD" = "PEN"): ProjectableSoldVariant => ({ variantId, currency, units, amount: { amount, currency } });
const described = (variantId: string, productId: string, productName: string, values: readonly string[], matchesText = true): ProjectableDescribedVariant =>
  ({ variantId, productId, productName, values, matchesText });

// The October example: Polo básico 8 units S/ 280.00 (M · Azul 5, L · Negro 3) and Casaca 3 units S/ 360.00 (M · Negro 2, L · Negro 1).
const october = {
  variants: [sold("polo-m", 5, 175), sold("polo-l", 3, 105), sold("casaca-m", 2, 240), sold("casaca-l", 1, 120)],
  currencies: [{ currency: "PEN" as const, orders: 4, units: 11, amount: pen(640) }],
};
const describedOctober = [
  described("polo-m", "polo", "Polo básico", ["M", "Azul"]), described("polo-l", "polo", "Polo básico", ["L", "Negro"]),
  described("casaca-m", "casaca", "Casaca", ["M", "Negro"]), described("casaca-l", "casaca", "Casaca", ["L", "Negro"]),
];
const options = { order: "units" as const, page: 1, storeCurrency: "PEN" as const };

describe("ranking sold products", () => {
  test("ranks the October example by units and by amount with whole-period shares", () => {
    const byUnits = rankSoldProducts(october, describedOctober, options);
    expect(byUnits).toMatchObject({ total: 2, units: 11, amount: pen(640), wholeAmount: pen(640) });
    expect(byUnits.items.map((item) => [item.name, item.units, item.amount.amount, item.share])).toEqual([
      ["Polo básico", 8, 280, { kind: "percent", value: 44 }], ["Casaca", 3, 360, { kind: "percent", value: 56 }],
    ]);
    expect(byUnits.items[0]!.variants.map((variant) => [variant.combination, variant.units, variant.amount.amount])).toEqual([["M / Azul", 5, 175], ["L / Negro", 3, 105]]);
    const byAmount = rankSoldProducts(october, describedOctober, { ...options, order: "amount" });
    expect(byAmount.items.map((item) => item.name)).toEqual(["Casaca", "Polo básico"]);
  });

  test("breaks ties by the other figure and then by name A–Z ignoring case and accents", () => {
    const variants = [sold("a", 2, 50), sold("b", 2, 80), sold("c", 2, 80), sold("d", 1, 80)];
    const names = [described("a", "pa", "Álamo", ["x"]), described("b", "pb", "beta", ["x"]), described("c", "pc", "Alfa", ["x"]), described("d", "pd", "Zeta", ["x"])];
    const totals = { variants, currencies: [{ currency: "PEN" as const, orders: 4, units: 7, amount: pen(290) }] };
    expect(rankSoldProducts(totals, names, options).items.map((item) => item.name)).toEqual(["Alfa", "beta", "Álamo", "Zeta"]);
    expect(rankSoldProducts(totals, names, { ...options, order: "amount" }).items.map((item) => item.name)).toEqual(["Alfa", "beta", "Zeta", "Álamo"]);
  });

  test("shows three variants and the remaining count, and every variant for one product", () => {
    const variants = ["a", "b", "c", "d", "e"].map((id, index) => sold(id, 5 - index, (5 - index) * 10));
    const names = variants.map((variant, index) => described(variant.variantId, "polo", "Polo básico", [`T${index}`]));
    const totals = { variants, currencies: [{ currency: "PEN" as const, orders: 5, units: 15, amount: pen(150) }] };
    const [item] = rankSoldProducts(totals, names, options).items;
    expect(item!.variants.map((variant) => variant.combination)).toEqual(["T0", "T1", "T2"]);
    expect(item!.moreVariants).toBe(2);
    const one = rankOneProduct(totals, names, "PEN");
    expect(one!.variants).toHaveLength(5);
    expect(one).toMatchObject({ units: 15, amount: pen(150), share: { kind: "percent", value: 100 } });
  });

  test("a variant ties by amount and then by combination A–Z", () => {
    const variants = [sold("a", 2, 20), sold("b", 2, 30), sold("c", 2, 30)];
    const names = [described("a", "p", "Polo", ["M"]), described("b", "p", "Polo", ["L"]), described("c", "p", "Polo", ["Azul"])];
    const [item] = rankSoldProducts({ variants, currencies: [{ currency: "PEN", orders: 3, units: 6, amount: pen(80) }] }, names, options).items;
    expect(item!.variants.map((variant) => variant.combination)).toEqual(["Azul", "L", "M"]);
  });

  test("a product without options shows no variant line", () => {
    const totals = { variants: [sold("g", 4, 100)], currencies: [{ currency: "PEN" as const, orders: 1, units: 4, amount: pen(100) }] };
    const [item] = rankSoldProducts(totals, [described("g", "gorro", "Gorro", [])], options).items;
    expect(item).toMatchObject({ name: "Gorro", variants: [], moreVariants: 0 });
  });

  test("keeps the whole-period share and the whole denominator when texto narrows the ranking", () => {
    const narrowed = describedOctober.map((variant) => ({ ...variant, matchesText: variant.productId === "polo" }));
    const ranking = rankSoldProducts(october, narrowed, { ...options, text: "polo" });
    expect(ranking).toMatchObject({ total: 1, units: 8, amount: pen(280), wholeAmount: pen(640) });
    expect(ranking.items[0]!.share).toEqual({ kind: "percent", value: 44 });
  });

  test("pages 20 products and reports the total", () => {
    const variants = Array.from({ length: 25 }, (_, index) => sold(`v${index}`, 100 - index, 100 - index));
    const names = variants.map((variant, index) => described(variant.variantId, `p${index}`, `Producto ${String(index).padStart(2, "0")}`, ["M"]));
    const totals = { variants, currencies: [{ currency: "PEN" as const, orders: 25, units: 2000, amount: pen(2000) }] };
    expect(rankSoldProducts(totals, names, options)).toMatchObject({ total: 25, page: 1 });
    expect(rankSoldProducts(totals, names, options).items).toHaveLength(20);
    expect(rankSoldProducts(totals, names, { ...options, page: 2 }).items.map((item) => item.name)).toEqual(
      ["Producto 20", "Producto 21", "Producto 22", "Producto 23", "Producto 24"]);
    expect(rankSoldProducts(totals, names, { ...options, page: 3 }).items).toEqual([]);
  });

  test("shows menos de 1% for a share below half a percent", () => {
    const totals = { variants: [sold("a", 1, 1), sold("b", 1, 999)], currencies: [{ currency: "PEN" as const, orders: 2, units: 2, amount: pen(1000) }] };
    const names = [described("a", "pa", "Chico", ["x"]), described("b", "pb", "Grande", ["x"])];
    expect(rankSoldProducts(totals, names, options).items.map((item) => item.share)).toEqual([{ kind: "percent", value: 100 }, { kind: "under_one" }]);
  });
});

describe("other currencies", () => {
  const mixed = {
    variants: [...october.variants, sold("polo-m", 3, 90, "USD"), sold("casaca-l", 1, 40, "USD")],
    currencies: [{ currency: "PEN" as const, orders: 4, units: 11, amount: pen(640) }, { currency: "USD" as const, orders: 2, units: 4, amount: usd(130) }],
  };

  test("ranks only the store currency and adds one line per other currency with its order count", () => {
    expect(rankSoldProducts(mixed, describedOctober, options)).toMatchObject({ total: 2, units: 11, amount: pen(640) });
    expect(otherCurrencySales(mixed, describedOctober, "PEN", false)).toEqual([{ currency: "USD", orders: 2, units: 4, amount: usd(130) }]);
  });

  test("filtered by texto or producto the line names units and amount of the matching products only, without an order count", () => {
    const narrowed = describedOctober.map((variant) => ({ ...variant, matchesText: variant.productId === "polo" }));
    expect(otherCurrencySales(mixed, narrowed, "PEN", true)).toEqual([{ currency: "USD", orders: null, units: 3, amount: usd(90) }]);
    expect(otherCurrencySales(mixed, narrowed.map((variant) => ({ ...variant, matchesText: false })), "PEN", true)).toEqual([]);
  });

  test("a store with October sales only in USD ranks nothing in the store currency", () => {
    const onlyUsd = { variants: [sold("polo-m", 3, 90, "USD")], currencies: [{ currency: "USD" as const, orders: 1, units: 3, amount: usd(90) }] };
    expect(rankSoldProducts(onlyUsd, describedOctober, options)).toMatchObject({ total: 0, items: [], wholeAmount: pen(0) });
    expect(otherCurrencySales(onlyUsd, describedOctober, "PEN", false)).toEqual([{ currency: "USD", orders: 1, units: 3, amount: usd(90) }]);
    expect(rankOneProduct(onlyUsd, describedOctober, "PEN")).toBeNull();
  });
});

describe("unsold products", () => {
  const stock = (total: number, soldOut = 0, low = 0, onlyLevel: ProjectableStockedProduct["stock"]["onlyLevel"] = null) => ({ total, soldOut, low, onlyLevel });
  const product = (name: string, total: number, variantIds: readonly string[], createdAt = "2026-01-01"): ProjectableStockedProduct =>
    ({ id: name.toLowerCase(), name, createdAt: new Date(`${createdAt}T15:00:00Z`), stock: stock(total), variantIds });
  const dates = (variantId: string, soldInWindow: boolean, lastBefore: string | null, firstAfter: string | null = null): ProjectableSaleDates =>
    ({ variantId, soldInWindow, lastBefore: lastBefore ? new Date(`${lastBefore}T15:00:00Z`) : null, firstAfter: firstAfter ? new Date(`${firstAfter}T15:00:00Z`) : null });
  const options = { page: 1, periodEndedBeforeToday: false };

  test("lists products with stock that did not sell, ordered by most stock, oldest last sale before the period with none first, then name", () => {
    const checked = [product("Abrigo", 10, ["a1"]), product("Bufanda", 10, ["b1"]), product("Zapato", 10, ["z1"]), product("Gorro", 30, ["g1"]), product("Polo", 50, ["p1"])];
    const found = [dates("a1", false, "2026-01-01"), dates("b1", false, "2025-03-14"), dates("z1", false, null), dates("g1", false, null), dates("p1", true, null)];
    const unsold = listUnsoldProducts(checked, found, options);
    expect(unsold).toMatchObject({ checked: 5, total: 4, page: 1 });
    expect(unsold.items.map((item) => item.product.name)).toEqual(["Gorro", "Zapato", "Bufanda", "Abrigo"]);
  });

  test("folds variant sale dates into the product's last sale before and first sale after the period", () => {
    const checked = [product("Casaca", 4, ["c1", "c2", "c3"])];
    const found = [dates("c1", false, "2026-05-01", "2026-12-10"), dates("c2", false, "2026-08-20", "2026-11-10"), dates("c3", false, null, null)];
    const [item] = listUnsoldProducts(checked, found, { page: 1, periodEndedBeforeToday: true }).items;
    expect(item).toMatchObject({ lastBefore: new Date("2026-08-20T15:00:00Z"), firstAfter: new Date("2026-11-10T15:00:00Z") });
    const [today] = listUnsoldProducts(checked, found, options).items;
    expect(today).toMatchObject({ lastBefore: new Date("2026-08-20T15:00:00Z"), firstAfter: null });
  });

  test("a product with any variant sold in the period is not listed, and a variant with no date row counts as never sold", () => {
    const checked = [product("Polo", 5, ["p1", "p2"]), product("Short", 5, ["s1"])];
    const found = [dates("p1", true, null), dates("p2", false, "2026-01-01")];
    expect(listUnsoldProducts(checked, found, options).items.map((item) => item.product.name)).toEqual(["Short"]);
  });

  test("pages 20 products and reports the total of unsold products", () => {
    const checked = Array.from({ length: 23 }, (_, index) => product(`P${String(index).padStart(2, "0")}`, 100 - index, [`v${index}`]));
    const found = checked.map((item) => dates(item.variantIds[0]!, false, null));
    expect(listUnsoldProducts(checked, found, options)).toMatchObject({ total: 23, checked: 23 });
    expect(listUnsoldProducts(checked, found, options).items).toHaveLength(20);
    expect(listUnsoldProducts(checked, found, { ...options, page: 2 }).items.map((item) => item.product.name)).toEqual(["P20", "P21", "P22"]);
  });
});
