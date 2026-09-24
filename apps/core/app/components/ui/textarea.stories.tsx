import type { Meta, StoryObj } from "@storybook/react-vite";
import { Field, FieldLabel } from "./field";
import { Textarea } from "./textarea";

const meta = {
  title: "Design System/Components/Textarea",
  component: Textarea,
} satisfies Meta<typeof Textarea>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="max-w-form">
      <Textarea name="description" rows={4} placeholder="Detalles del producto" aria-label="Descripción" />
    </div>
  ),
};

export const States: Story = {
  name: "Estados",
  render: () => (
    <div className="flex max-w-form flex-col gap-4">
      <Textarea name="normal" rows={3} placeholder="Normal" aria-label="Normal" />
      <Textarea name="value" rows={3} defaultValue={"Descripción con contenido.\nSegunda línea."} aria-label="Con valor" />
      <Textarea name="disabled" rows={3} placeholder="Deshabilitado" disabled aria-label="Deshabilitado" />
      <Textarea name="invalid" rows={3} placeholder="Inválido" aria-invalid aria-label="Inválido" />
    </div>
  ),
};

export const WithField: Story = {
  name: "Dentro de Field",
  render: () => (
    <div className="max-w-form">
      <Field error="La descripción es demasiado larga.">
        <FieldLabel>Descripción</FieldLabel>
        <Textarea name="description" rows={4} defaultValue="Producto de temporada con acabado premium." />
      </Field>
    </div>
  ),
};
