import type { Meta, StoryObj } from "@storybook/react-vite";
import { ShoppingBag } from "lucide-react";
import { Button } from "./button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./empty";

const meta = { title: "Design System/Components/Empty", component: Empty } satisfies Meta<typeof Empty>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Empty className="max-w-form border">
      <EmptyHeader>
        <EmptyMedia variant="icon"><ShoppingBag aria-hidden="true" /></EmptyMedia>
        <EmptyTitle>No hay pedidos con estos filtros</EmptyTitle>
        <EmptyDescription>Prueba con otra búsqueda o quita los filtros.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent><Button variant="outline">Limpiar filtros</Button></EmptyContent>
    </Empty>
  ),
};
