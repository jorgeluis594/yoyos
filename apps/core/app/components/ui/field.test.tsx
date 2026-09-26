import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const inputId = (html: string) => html.match(/<input[^>]* id="([^"]+)"/)?.[1];

test("wires the label to its control id", () => {
  const html = renderToStaticMarkup(
    <Field>
      <FieldLabel htmlFor="name">Nombre</FieldLabel>
      <Input id="name" name="name" />
    </Field>,
  );
  const id = inputId(html);
  expect(id).toBeTruthy();
  expect(html).toContain(`for="${id}"`);
  expect(html).not.toContain('aria-invalid="');
  expect(html).not.toContain('aria-describedby="');
});

test("marks the field and control invalid and associates its error message", () => {
  const html = renderToStaticMarkup(
    <Field data-invalid>
      <FieldLabel htmlFor="salePrice">Precio</FieldLabel>
      <Input id="salePrice" name="salePrice" aria-invalid aria-describedby="salePrice-error" />
      <FieldError id="salePrice-error">El precio debe ser mayor a 0.</FieldError>
    </Field>,
  );
  expect(html).toContain('data-invalid="true"');
  expect(html).toContain('aria-invalid="true"');
  expect(html).toContain('aria-describedby="salePrice-error"');
  expect(html).toContain('id="salePrice-error"');
  expect(html).toContain('role="alert"');
  expect(html).toContain("El precio debe ser mayor a 0.");
});

test("shares the same wiring with select and textarea", () => {
  const html = renderToStaticMarkup(
    <Field data-invalid>
      <FieldLabel htmlFor="country">País</FieldLabel>
      <Select name="country" items={[{ value: null, label: "País" }]} required>
        <SelectTrigger id="country" aria-invalid aria-describedby="country-error"><SelectValue placeholder="País" /></SelectTrigger>
      </Select>
      <Textarea id="notes" name="notes" aria-invalid aria-describedby="notes-error" />
      <FieldError id="country-error">País obligatorio</FieldError>
      <FieldError id="notes-error">Obligatorio</FieldError>
    </Field>,
  );
  expect(html.match(/aria-invalid="true"/g)).toHaveLength(2);
  expect(html.match(/role="alert"/g)).toHaveLength(2);
  expect(html).toContain('name="country"');
  expect(html).toContain('id="notes"');
  expect(html).toContain('required=""');
});

test("explicit id and aria attributes win over the field context", () => {
  const html = renderToStaticMarkup(
    <Field id="sku-field" data-invalid>
      <FieldLabel htmlFor="sku">SKU</FieldLabel>
      <Input id="sku" name="sku" aria-describedby="sku-hint" />
      <FieldError id="sku-error">Duplicado</FieldError>
    </Field>,
  );
  expect(html).toContain('id="sku-field"');
  expect(html).toContain('id="sku"');
  expect(html).toContain('for="sku"');
  expect(html).toContain('aria-describedby="sku-hint"');
  expect(html).toContain('id="sku-error"');
});
