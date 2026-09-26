import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./button";
import { ErrorState } from "./error-state";

const meta = {
  title: "Design System/Components/ErrorState",
  component: ErrorState,
} satisfies Meta<typeof ErrorState>;
export default meta;

type Story = StoryObj<typeof meta>;

export const NotFound: Story = {
  args: {
    title: "Producto no encontrado",
    description: "No hay un producto disponible en esta dirección.",
    action: <Button variant="outline">Volver a productos</Button>,
  },
};

export const ServerError: Story = {
  args: {
    title: "No se pudo cargar el catálogo",
    description: "Inténtalo de nuevo.",
    action: <Button variant="outline">Reintentar</Button>,
  },
};
