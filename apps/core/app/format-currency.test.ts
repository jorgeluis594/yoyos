import { expect, test } from "vitest";
import { formatCurrency } from "@core/app/format-currency";

test("formats the amount in the selected language without changing its currency", () => {
  const spanish = formatCurrency(1234.5, "PEN", "es");
  const portuguese = formatCurrency(1234.5, "PEN", "pt");
  expect(spanish).toContain("1,234.50");
  expect(portuguese).toContain("1.234,50");
  expect(portuguese).toMatch(/PEN|S\//);
});
