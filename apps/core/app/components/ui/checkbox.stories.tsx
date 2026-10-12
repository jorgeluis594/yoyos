import type { Meta, StoryObj } from "@storybook/react-vite";
import { Checkbox } from "./checkbox";
import { Field, FieldContent, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "./field";

const meta = { title: "Design System/Components/Checkbox", component: Checkbox } satisfies Meta<typeof Checkbox>;
export default meta;
type Story = StoryObj<typeof meta>;

export const WithLabel: Story = {
  name: "Con etiqueta",
  render: () => (
    <FieldSet className="max-w-form">
      <FieldLegend variant="label">Métodos de pago</FieldLegend>
      <Field orientation="horizontal"><Checkbox id="wallet" name="wallet" defaultChecked /><FieldLabel htmlFor="wallet">Billetera digital</FieldLabel></Field>
      <Field orientation="horizontal"><Checkbox id="transfer" name="transfer" /><FieldLabel htmlFor="transfer">Transferencia</FieldLabel></Field>
      <Field orientation="horizontal" data-disabled><Checkbox id="cash" name="cash" disabled /><FieldLabel htmlFor="cash">Efectivo</FieldLabel></Field>
    </FieldSet>
  ),
};

export const WithDescription: Story = {
  name: "Con descripción",
  render: () => (
    <Field orientation="horizontal" className="max-w-form">
      <Checkbox id="home-enabled" defaultChecked />
      <FieldContent>
        <FieldLabel htmlFor="home-enabled">Envío a domicilio</FieldLabel>
        <FieldDescription>Los compradores pueden pedir envío a su dirección.</FieldDescription>
      </FieldContent>
    </Field>
  ),
};
