import type { Meta, StoryObj } from "@storybook/react-vite";
import { Field, FieldContent, FieldDescription, FieldLabel, FieldLegend, FieldSet, FieldTitle } from "./field";
import { RadioGroup, RadioGroupItem } from "./radio-group";

const meta = { title: "Design System/Components/RadioGroup", component: RadioGroup } satisfies Meta<typeof RadioGroup>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <FieldSet className="max-w-form">
      <FieldLegend variant="label">Fondo del checkout</FieldLegend>
      <RadioGroup defaultValue="white" name="background">
        <Field orientation="horizontal"><RadioGroupItem value="white" id="bg-white" /><FieldLabel htmlFor="bg-white">Blanco</FieldLabel></Field>
        <Field orientation="horizontal"><RadioGroupItem value="neutral" id="bg-neutral" /><FieldLabel htmlFor="bg-neutral">Neutro</FieldLabel></Field>
      </RadioGroup>
    </FieldSet>
  ),
};

export const ChoiceCards: Story = {
  name: "Tarjetas de opción",
  render: () => (
    <FieldSet className="max-w-form">
      <FieldLegend variant="label">Método de pago</FieldLegend>
      <RadioGroup defaultValue="wallet" name="payment-method" className="grid-cols-2">
        <FieldLabel htmlFor="pay-wallet">
          <Field orientation="horizontal"><RadioGroupItem value="wallet" id="pay-wallet" /><FieldContent><FieldTitle>Yape</FieldTitle><FieldDescription>Billetera digital</FieldDescription></FieldContent></Field>
        </FieldLabel>
        <FieldLabel htmlFor="pay-transfer">
          <Field orientation="horizontal"><RadioGroupItem value="transfer" id="pay-transfer" /><FieldContent><FieldTitle>Transferencia</FieldTitle><FieldDescription>Cuenta bancaria</FieldDescription></FieldContent></Field>
        </FieldLabel>
      </RadioGroup>
    </FieldSet>
  ),
};
