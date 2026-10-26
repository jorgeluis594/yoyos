import { describe, expect, test } from "vitest";
import { ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { changeVariantCombination, type ChangeVariantCombinationDependencies, type ChangeVariantCombinationInput } from "@core/src/features/products/application/change-variant-combination";
import type { CombinationPlan } from "@core/src/features/products/domain/variant-rules";
import type { Product } from "@core/src/features/products/domain/product";
import { azul, color, large, lAzul, lNegro, medium, mNegro, negro, newId, productId, shirts, simple, talla, when } from "@core/src/features/products/application/variant-action-fixtures";

const access = { companyId: "00000000-0000-4000-8000-0000000000aa" as never };

function setup(stored: Product | null = shirts(), foreign: readonly string[] = []) {
  const writes: CombinationPlan[] = [];
  const completed: unknown[] = [];
  const rejected: string[] = [];
  const lookups: (readonly string[])[] = [];
  const deps: ChangeVariantCombinationDependencies = {
    transaction: async <T, E extends { code: string; message: string }>(_companyId: unknown, work: () => Promise<Result<T, E>>) => work(),
    lockProduct: async () => ok(stored !== null),
    loadProduct: async () => ok(stored),
    findForeignOptionIds: async (ids) => { lookups.push(ids); return ok(new Set(ids.filter((value) => foreign.includes(value)))); },
    applyCombinationChange: async (_id, plan) => { writes.push(plan); return ok(undefined); },
    clock: () => when,
    observe: { completed: (summary) => completed.push(summary), rejected: (event) => rejected.push(event.errorCode) },
  };
  return { deps, writes, completed, rejected, lookups };
}

const input = (values: ChangeVariantCombinationInput["values"], variantId = mNegro): ChangeVariantCombinationInput => ({ productId, variantId, values });

describe("change variant combination", () => {
  test("appends a new value at the end of its option", async () => {
    const context = setup();
    const result = await changeVariantCombination(input([{ optionId: talla, newValue: { id: newId(1), name: " XL " } }, { optionId: color, valueId: negro }]), access, context.deps);
    expect(result).toEqual({ success: true, data: productId });
    expect(context.writes).toHaveLength(1);
    expect(context.writes[0]).toMatchObject({
      variantId: mNegro, newValue: { id: newId(1), optionId: talla, name: "XL" },
      changedLinks: [{ optionId: talla, valueId: newId(1) }], deleteValueIds: [], deleteOptionIds: [],
    });
    expect(context.lookups).toEqual([[newId(1)]]);
    expect(context.completed).toEqual([{ variantId: mNegro, createdValue: true, removedValues: 0 }]);
  });

  test("rejects a combination another variant has", async () => {
    const context = setup();
    const result = await changeVariantCombination(input([{ optionId: talla, valueId: medium }, { optionId: color, valueId: azul }]), access, context.deps);
    expect(result).toEqual({ success: false, error: expect.objectContaining({ code: "DUPLICATE_COMBINATION" }) });
    expect(context.writes).toEqual([]);
    expect(context.rejected).toEqual(["DUPLICATE_COMBINATION"]);
  });

  test("removes a value left without variants", async () => {
    const stored = shirts();
    const twoLeft: Product = { ...stored, variants: stored.variants.filter((variant) => variant.id === mNegro || variant.id === lNegro) as unknown as Product["variants"] };
    const context = setup(twoLeft);
    const result = await changeVariantCombination(input([{ optionId: talla, valueId: medium }, { optionId: color, valueId: azul }], lNegro), access, context.deps);
    expect(result.success).toBe(true);
    expect(context.writes[0]).toMatchObject({ variantId: lNegro, deleteValueIds: [large], deleteOptionIds: [],
      changedLinks: [{ optionId: talla, valueId: medium }, { optionId: color, valueId: azul }] });
    expect(context.completed).toEqual([{ variantId: lNegro, createdValue: false, removedValues: 1 }]);
  });

  test("repeating a combination with a newValue that already exists succeeds without writing", async () => {
    const stored = shirts();
    const withXl: Product = { ...stored, options: [{ ...stored.options[0], values: [...stored.options[0].values, { id: newId(3), name: "XL" as never }] }, stored.options[1]] as unknown as Product["options"],
      variants: stored.variants.map((variant) => variant.id === mNegro ? { ...variant, combination: { [talla]: newId(3), [color]: negro } } : variant) as unknown as Product["variants"] };
    const context = setup(withXl);
    const result = await changeVariantCombination(input([{ optionId: talla, newValue: { id: newId(3), name: " xl" } }, { optionId: color, valueId: negro }]), access, context.deps);
    expect(result).toEqual({ success: true, data: productId });
    expect(context.writes).toEqual([]);
    expect(context.lookups).toEqual([]);
    expect(context.completed).toEqual([]);
  });

  test("reports a reused value id, a repeated name, a missing option and a value of another option together", async () => {
    const context = setup(shirts(), [newId(4)]);
    const conflict = await changeVariantCombination(input([{ optionId: talla, newValue: { id: newId(4), name: "XL" } }, { optionId: color, valueId: negro }]), access, context.deps);
    expect(conflict).toEqual({ success: false, error: expect.objectContaining({ code: "VALIDATION_ERROR", issues: [expect.objectContaining({ scope: "value", valueId: newId(4), field: "id", reason: "ID_CONFLICT" })] }) });
    const sameName = await changeVariantCombination(input([{ optionId: talla, newValue: { id: newId(5), name: "l" } }, { optionId: color, valueId: negro }]), access, context.deps);
    expect(sameName).toEqual({ success: false, error: expect.objectContaining({ issues: [expect.objectContaining({ scope: "value", optionIndex: 0, valueIndex: 2, reason: "DUPLICATE_VALUE" })] }) });
    const missing = await changeVariantCombination(input([{ optionId: talla, valueId: negro }]), access, context.deps);
    expect(missing).toEqual({ success: false, error: expect.objectContaining({ issues: [expect.objectContaining({ scope: "variant", variantId: mNegro, field: "values", reason: "INVALID_COMBINATION" })] }) });
    const ownId = await changeVariantCombination(input([{ optionId: talla, newValue: { id: azul, name: "XL" } }, { optionId: color, valueId: negro }]), access, context.deps);
    expect(ownId).toEqual({ success: false, error: expect.objectContaining({ issues: [expect.objectContaining({ reason: "ID_CONFLICT" })] }) });
    expect(context.writes).toEqual([]);
  });

  test("answers PRODUCT_WITHOUT_OPTIONS, VARIANT_NOT_FOUND and PRODUCT_NOT_FOUND before validating the values", async () => {
    const bare = simple();
    const without = await changeVariantCombination(input([], bare.variants[0].id), access, setup(bare).deps);
    expect(without).toEqual({ success: false, error: expect.objectContaining({ code: "PRODUCT_WITHOUT_OPTIONS" }) });
    expect(await changeVariantCombination(input([], newId(9) as never), access, setup().deps)).toEqual({ success: false, error: expect.objectContaining({ code: "VARIANT_NOT_FOUND" }) });
    expect(await changeVariantCombination(input([]), access, setup(null).deps)).toEqual({ success: false, error: expect.objectContaining({ code: "PRODUCT_NOT_FOUND" }) });
  });

  test("reports a value that does not belong to the option and a thirty-first value", async () => {
    const context = setup();
    const foreignValue = await changeVariantCombination(input([{ optionId: talla, valueId: azul }, { optionId: color, valueId: negro }]), access, context.deps);
    expect(foreignValue).toEqual({ success: false, error: expect.objectContaining({ issues: [expect.objectContaining({ scope: "variant", field: "values", reason: "VALUE_NOT_FOUND" })] }) });
    const stored = shirts();
    const full: Product = { ...stored, options: [{ ...stored.options[0], values: [...stored.options[0].values, ...Array.from({ length: 28 }, (_, index) => ({ id: newId(50 + index), name: `T${index}` as never }))] }, stored.options[1]] as unknown as Product["options"] };
    const many = await changeVariantCombination(input([{ optionId: talla, newValue: { id: newId(90), name: "Último" } }, { optionId: color, valueId: negro }]), access, setup(full).deps);
    expect(many).toEqual({ success: false, error: expect.objectContaining({ issues: [expect.objectContaining({ scope: "option", optionIndex: 0, field: "values", reason: "TOO_MANY_VALUES", maximum: 30 })] }) });
  });
});
