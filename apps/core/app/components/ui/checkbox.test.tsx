import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";

test("renders a labelled checkbox with its checked state", () => {
  const html = renderToStaticMarkup(
    <Field orientation="horizontal">
      <Checkbox id="store-enabled" defaultChecked />
      <FieldLabel htmlFor="store-enabled">Activo</FieldLabel>
    </Field>,
  );
  expect(html).toContain('data-orientation="horizontal"');
  expect(html).toMatch(/<button[^>]*role="checkbox"[^>]*aria-checked="true"/);
  expect(html).toContain('id="store-enabled"');
  expect(html).toContain('for="store-enabled"');
});
