import type { Meta, StoryObj } from "@storybook/react-vite";
import { CircleCheck, CircleX, CreditCard, Truck } from "lucide-react";
import { Badge } from "./badge";

const meta = { title: "Design System/Components/Badge", component: Badge } satisfies Meta<typeof Badge>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Variants: Story = {
  name: "Variantes",
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge variant="secondary">Sin guardar</Badge>
      <Badge variant="success"><CircleCheck data-icon="inline-start" aria-hidden="true" />Completado</Badge>
      <Badge variant="warning"><Truck data-icon="inline-start" aria-hidden="true" />Envío pendiente</Badge>
      <Badge variant="info"><CreditCard data-icon="inline-start" aria-hidden="true" />Pagado</Badge>
      <Badge variant="destructive"><CircleX data-icon="inline-start" aria-hidden="true" />Cancelado</Badge>
      <Badge variant="outline">Borrador</Badge>
    </div>
  ),
};
