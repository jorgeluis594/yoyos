import { expect, test } from "vitest";
import { resolveSalesPeriod } from "@core/src/features/assistants/domain/sales-period";
import { periodRefusalMessage } from "@core/src/features/assistants/presentation/tools/sales-texts";

const refusal = (input: { desde?: string; hasta?: string }) => {
  const result = resolveSalesPeriod(input, "2026-10-31");
  if (result.success) throw new Error("expected a refusal");
  return periodRefusalMessage(result.error);
};

test("words each refusal of the period with the field and the remedy, dates as AAAA-MM-DD", () => {
  expect(refusal({ hasta: "2026-10-10" })).toBe("Indica también la fecha inicial (desde).");
  expect(refusal({ desde: "2026-10-07", hasta: "2026-10-01" })).toBe("La fecha final (2026-10-01) es anterior a la inicial (2026-10-07).");
  expect(refusal({ desde: "2026-11-05" })).toBe("La fecha inicial (2026-11-05) es posterior a hoy (2026-10-31).");
  expect(refusal({ desde: "2025-01-01" })).toBe("El periodo puede tener hasta 366 días. Pide uno más corto.");
});
