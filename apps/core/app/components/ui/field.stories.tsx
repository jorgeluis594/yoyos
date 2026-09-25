import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./button";
import { Field, FieldError, FieldLabel } from "./field";
import { Input } from "./input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./select";
import { Textarea } from "./textarea";

const meta = {
  title: "Design System/Components/Field",
  component: Field,
} satisfies Meta<typeof Field>;
export default meta;

type Story = StoryObj<typeof meta>;

export const TextField: Story = {
  render: () => (
    <Field className="max-w-form">
      <FieldLabel htmlFor="name">Nombre</FieldLabel>
      <Input id="name" name="name" placeholder="Polo oversize" />
    </Field>
  ),
};

export const WithError: Story = {
  render: () => (
    <Field className="max-w-form" data-invalid>
      <FieldLabel htmlFor="salePrice">Precio de venta (PEN)</FieldLabel>
      <Input id="salePrice" name="salePrice" type="number" inputMode="decimal" defaultValue="0" aria-invalid aria-describedby="salePrice-error" />
      <FieldError id="salePrice-error">El precio debe ser mayor a 0.</FieldError>
    </Field>
  ),
};

export const Disabled: Story = {
  render: () => (
    <Field className="max-w-form">
      <FieldLabel htmlFor="stock">Stock</FieldLabel>
      <Input id="stock" name="stock" value={24} readOnly aria-readonly="true" className="bg-muted text-muted-foreground" />
    </Field>
  ),
};

export const SelectField: Story = {
  render: () => (
    <Field className="max-w-form">
      <FieldLabel htmlFor="country">País</FieldLabel>
      <Select name="country" items={[{ value: null, label: "Selecciona un país" }, { value: "PE", label: "Perú" }, { value: "CO", label: "Colombia" }]}>
        <SelectTrigger id="country"><SelectValue placeholder="Selecciona un país" /></SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value={null} disabled>Selecciona un país</SelectItem>
            <SelectItem value="PE">Perú</SelectItem>
            <SelectItem value="CO">Colombia</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  ),
};

export const TextareaField: Story = {
  render: () => (
    <Field className="max-w-form">
      <FieldLabel htmlFor="description">Descripción</FieldLabel>
      <Textarea id="description" name="description" rows={4} placeholder="Detalles del producto" />
    </Field>
  ),
};

/** Canonical two-column form grid: wide fields span both columns. */
export const ComposedForm: Story = {
  render: () => (
    <form className="flex max-w-form flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field className="sm:col-span-2">
          <FieldLabel htmlFor="product-name">Nombre *</FieldLabel>
          <Input id="product-name" name="name" required />
        </Field>
        <Field>
          <FieldLabel htmlFor="product-sku">SKU</FieldLabel>
          <Input id="product-sku" name="sku" />
        </Field>
        <Field data-invalid>
          <FieldLabel htmlFor="product-price">Precio de venta (PEN) *</FieldLabel>
          <Input id="product-price" name="salePrice" type="number" inputMode="decimal" defaultValue="0" aria-invalid aria-describedby="product-price-error" />
          <FieldError id="product-price-error">El precio debe ser mayor a 0.</FieldError>
        </Field>
        <Field className="sm:col-span-2">
          <FieldLabel htmlFor="product-description">Descripción</FieldLabel>
          <Textarea id="product-description" name="description" rows={3} />
        </Field>
      </div>
      <div className="flex flex-wrap gap-3 border-t border-border pt-5">
        <Button type="submit">Guardar producto</Button>
        <Button type="button" variant="outline">Cancelar</Button>
      </div>
    </form>
  ),
};
