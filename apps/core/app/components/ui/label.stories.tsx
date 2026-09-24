import type { Meta, StoryObj } from "@storybook/react-vite";
import { Input } from "./input";
import { Label } from "./label";

const meta = {
  title: "Design System/Components/Label",
  component: Label,
} satisfies Meta<typeof Label>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { children: "Nombre" },
};

export const WithControl: Story = {
  name: "Con control",
  render: () => (
    <div className="flex max-w-form flex-col gap-2">
      <Label htmlFor="label-demo">Precio de venta (PEN)</Label>
      <Input id="label-demo" name="salePrice" type="number" inputMode="decimal" placeholder="0.00" />
    </div>
  ),
};

export const Required: Story = {
  name: "Requerido",
  args: { children: "Nombre *" },
};
