import type { Meta, StoryObj } from "@storybook/react-vite";
import { Field, FieldLabel } from "./field";
import { Input } from "./input";

const meta = {
  title: "Design System/Components/Input",
  component: Input,
} satisfies Meta<typeof Input>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="max-w-form">
      <Input name="name" placeholder="Polo oversize" aria-label="Nombre" />
    </div>
  ),
};

export const States: Story = {
  name: "Estados",
  render: () => (
    <div className="flex max-w-form flex-col gap-4">
      <Input name="normal" placeholder="Normal" aria-label="Normal" />
      <Input name="value" defaultValue="Con valor" aria-label="Con valor" />
      <Input name="disabled" placeholder="Deshabilitado" disabled aria-label="Deshabilitado" />
      <Input name="invalid" placeholder="Inválido" aria-invalid aria-label="Inválido" />
    </div>
  ),
};

export const Types: Story = {
  name: "Tipos",
  render: () => (
    <div className="flex max-w-form flex-col gap-4">
      <Input name="text" type="text" placeholder="text" aria-label="Texto" />
      <Input name="email" type="email" placeholder="correo@ejemplo.com" aria-label="Correo" />
      <Input name="password" type="password" defaultValue="secreto123" aria-label="Contraseña" />
      <Input name="search" type="search" placeholder="Buscar" aria-label="Búsqueda" />
      <Input name="number" type="number" inputMode="decimal" placeholder="0.00" aria-label="Número" />
    </div>
  ),
};

export const WithField: Story = {
  name: "Dentro de Field",
  render: () => (
    <div className="flex max-w-form flex-col gap-6">
      <Field>
        <FieldLabel>Nombre</FieldLabel>
        <Input name="name" placeholder="Polo oversize" />
      </Field>
      <Field error="El precio debe ser mayor a 0.">
        <FieldLabel>Precio de venta (PEN)</FieldLabel>
        <Input name="salePrice" type="number" inputMode="decimal" defaultValue="0" />
      </Field>
    </div>
  ),
};
