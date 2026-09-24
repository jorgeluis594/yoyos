import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./button";
import { Field, FieldLabel } from "./field";
import { Input } from "./input";
import { Select } from "./select";
import { Textarea } from "./textarea";

const meta = { component: Field } satisfies Meta<typeof Field>;
export default meta;

type Story = StoryObj<typeof meta>;

export const TextField: Story = {
  render: () => (
    <Field className="max-w-form">
      <FieldLabel>Nombre</FieldLabel>
      <Input name="name" placeholder="Polo oversize" />
    </Field>
  ),
};

export const WithError: Story = {
  render: () => (
    <Field className="max-w-form" error="El precio debe ser mayor a 0.">
      <FieldLabel>Precio de venta (PEN)</FieldLabel>
      <Input name="salePrice" type="number" inputMode="decimal" defaultValue="0" />
    </Field>
  ),
};

export const Disabled: Story = {
  render: () => (
    <Field className="max-w-form">
      <FieldLabel>Stock</FieldLabel>
      <Input name="stock" value={24} readOnly aria-readonly="true" className="bg-muted text-muted-foreground" />
    </Field>
  ),
};

export const SelectField: Story = {
  render: () => (
    <Field className="max-w-form">
      <FieldLabel>País</FieldLabel>
      <Select name="country" defaultValue="">
        <option value="" disabled>Selecciona un país</option>
        <option value="PE">Perú</option>
        <option value="CO">Colombia</option>
      </Select>
    </Field>
  ),
};

export const TextareaField: Story = {
  render: () => (
    <Field className="max-w-form">
      <FieldLabel>Descripción</FieldLabel>
      <Textarea name="description" rows={4} placeholder="Detalles del producto" />
    </Field>
  ),
};

/** Canonical two-column form grid: wide fields span both columns. */
export const ComposedForm: Story = {
  render: () => (
    <form className="flex max-w-form flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field className="sm:col-span-2">
          <FieldLabel>Nombre *</FieldLabel>
          <Input name="name" required />
        </Field>
        <Field>
          <FieldLabel>SKU</FieldLabel>
          <Input name="sku" />
        </Field>
        <Field error="El precio debe ser mayor a 0.">
          <FieldLabel>Precio de venta (PEN) *</FieldLabel>
          <Input name="salePrice" type="number" inputMode="decimal" defaultValue="0" />
        </Field>
        <Field className="sm:col-span-2">
          <FieldLabel>Descripción</FieldLabel>
          <Textarea name="description" rows={3} />
        </Field>
      </div>
      <div className="flex flex-wrap gap-3 border-t border-border pt-5">
        <Button type="submit">Guardar producto</Button>
        <Button type="button" variant="outline">Cancelar</Button>
      </div>
    </form>
  ),
};
