import type { Meta, StoryObj } from "@storybook/react-vite";
import { Field, FieldLabel } from "./field";
import { Select } from "./select";

const meta = {
  title: "Design System/Components/Select",
  component: Select,
} satisfies Meta<typeof Select>;
export default meta;

type Story = StoryObj<typeof meta>;

const countries = (
  <>
    <option value="" disabled>Selecciona un país</option>
    <option value="PE">Perú</option>
    <option value="CO">Colombia</option>
    <option value="AR">Argentina</option>
    <option value="CL">Chile</option>
  </>
);

export const Default: Story = {
  render: () => (
    <div className="max-w-form">
      <Select name="country" defaultValue="" aria-label="País">{countries}</Select>
    </div>
  ),
};

export const States: Story = {
  name: "Estados",
  render: () => (
    <div className="flex max-w-form flex-col gap-4">
      <Select name="normal" defaultValue="PE" aria-label="Normal">{countries}</Select>
      <Select name="disabled" defaultValue="PE" disabled aria-label="Deshabilitado">{countries}</Select>
      <Select name="invalid" defaultValue="" aria-invalid aria-label="Inválido">{countries}</Select>
    </div>
  ),
};

export const WithField: Story = {
  name: "Dentro de Field",
  render: () => (
    <div className="flex max-w-form flex-col gap-6">
      <Field>
        <FieldLabel>País</FieldLabel>
        <Select name="country">{countries}</Select>
      </Field>
      <Field error="Selecciona un país válido.">
        <FieldLabel>País</FieldLabel>
        <Select name="countryInvalid">{countries}</Select>
      </Field>
    </div>
  ),
};
