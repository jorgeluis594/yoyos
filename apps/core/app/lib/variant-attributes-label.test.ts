import { expect, test } from "vitest";
import { attributesLabel } from "@core/app/lib/variant-attributes-label";

test("joins the values in arrival order with the combination separator and leaves a product without options empty", () => {
  expect(attributesLabel({ Talla: "L", Color: "Azul" })).toBe("L / Azul");
  expect(attributesLabel({ Color: "Azul", Talla: "L" })).toBe("Azul / L");
  expect(attributesLabel({ Talla: "L" })).toBe("L");
  expect(attributesLabel({})).toBe("");
});
