import type { Meta, StoryObj } from "@storybook/react-vite";
import { DescriptionDetails, DescriptionItem, DescriptionList, DescriptionTerm } from "./description-list";

const meta = { title: "Design System/Components/DescriptionList", component: DescriptionList } satisfies Meta<typeof DescriptionList>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Horizontal: Story = {
  render: () => (
    <DescriptionList className="max-w-form">
      <DescriptionItem><DescriptionTerm>Subtotal</DescriptionTerm><DescriptionDetails>S/ 120.00</DescriptionDetails></DescriptionItem>
      <DescriptionItem><DescriptionTerm>Envío</DescriptionTerm><DescriptionDetails>S/ 10.00</DescriptionDetails></DescriptionItem>
      <DescriptionItem className="border-t pt-2 font-medium"><DescriptionTerm className="text-foreground">Total</DescriptionTerm><DescriptionDetails>S/ 130.00</DescriptionDetails></DescriptionItem>
    </DescriptionList>
  ),
};

export const Vertical: Story = {
  render: () => (
    <DescriptionList orientation="vertical" className="max-w-form">
      <DescriptionItem><DescriptionTerm>Banco</DescriptionTerm><DescriptionDetails>BCP</DescriptionDetails></DescriptionItem>
      <DescriptionItem><DescriptionTerm>Titular</DescriptionTerm><DescriptionDetails>Tienda Yoyos SAC</DescriptionDetails></DescriptionItem>
    </DescriptionList>
  ),
};
