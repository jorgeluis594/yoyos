import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "./dialog";

const meta = { title: "Design System/Components/Dialog", component: Dialog } satisfies Meta<typeof Dialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Confirmation: Story = {
  name: "Confirmación",
  render: () => (
    <Dialog>
      <DialogTrigger asChild><Button variant="destructive">Cancelar pedido</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>¿Cancelar el pedido?</DialogTitle>
          <DialogDescription>El stock vuelve al catálogo y el comprador ya no podrá pagar.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Mantener pedido</Button></DialogClose>
          <Button variant="destructive">Cancelar pedido</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

export const WithCloseButton: Story = {
  name: "Con botón cerrar",
  render: () => (
    <Dialog defaultOpen>
      <DialogContent closeLabel="Cerrar">
        <DialogHeader><DialogTitle>Color de marca</DialogTitle><DialogDescription>Elige el color de tus botones.</DialogDescription></DialogHeader>
      </DialogContent>
    </Dialog>
  ),
};
