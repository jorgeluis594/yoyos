import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const inputId = (html: string) => html.match(/<input[^>]* id="([^"]+)"/)?.[1];

test("wires the label to the control with a generated id", () => {
  const html = renderToStaticMarkup(
    <Field>
      <FieldLabel>Nombre</FieldLabel>
      <Input name="name" />
    </Field>,
  );
  const id = inputId(html);
  expect(id).toBeTruthy();
  expect(html).toContain(`for="${id}"`);
  expect(html).not.toContain('aria-invalid="');
  expect(html).not.toContain('aria-describedby="');
});

test("marks the control invalid and describes it with the field error", () => {
  const html = renderToStaticMarkup(
    <Field error="El precio debe ser mayor a 0.">
      <FieldLabel>Precio</FieldLabel>
      <Input name="salePrice" />
    </Field>,
  );
  const id = inputId(html);
  expect(html).toContain('aria-invalid="true"');
  expect(html).toContain(`aria-describedby="${id}-error"`);
  expect(html).toContain(`id="${id}-error" role="alert"`);
  expect(html).toContain("El precio debe ser mayor a 0.");
});

test("shares the same wiring with select and textarea", () => {
  const html = renderToStaticMarkup(
    <Field error="Obligatorio">
      <FieldLabel>País</FieldLabel>
      <Select name="country" />
      <Textarea name="notes" />
    </Field>,
  );
  expect(html.match(/aria-invalid="true"/g)).toHaveLength(2);
  expect(html.match(/role="alert"/g)).toHaveLength(1);
});

test("explicit id and aria attributes win over the field context", () => {
  const html = renderToStaticMarkup(
    <Field id="sku" error="Duplicado">
      <FieldLabel>SKU</FieldLabel>
      <Input name="sku" aria-describedby="sku-hint" />
    </Field>,
  );
  expect(html).toContain('id="sku"');
  expect(html).toContain('for="sku"');
  expect(html).toContain('aria-describedby="sku-hint"');
  expect(html).toContain('id="sku-error"');
});
