import type { Meta, StoryObj } from "@storybook/react-vite";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "./alert";
import { Button } from "./button";

const meta = { title: "Design System/Components/Alert", component: Alert } satisfies Meta<typeof Alert>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Variants: Story = {
  name: "Variantes",
  render: () => (
    <div className="flex max-w-form flex-col gap-3">
      <Alert variant="destructive"><CircleAlert aria-hidden="true" /><AlertTitle>No se pudo guardar el producto.</AlertTitle></Alert>
      <Alert variant="success"><CircleCheck aria-hidden="true" /><AlertTitle>Cambios guardados.</AlertTitle></Alert>
      <Alert variant="warning"><TriangleAlert aria-hidden="true" /><AlertTitle>El stock es menor a la cantidad pedida.</AlertTitle></Alert>
      <Alert variant="info"><Info aria-hidden="true" /><AlertTitle>La cotización se enviará por WhatsApp.</AlertTitle></Alert>
      <Alert><AlertTitle>Subiendo imagen…</AlertTitle></Alert>
    </div>
  ),
};

export const WithAction: Story = {
  name: "Con acción",
  render: () => (
    <Alert variant="destructive" className="max-w-form">
      <CircleAlert aria-hidden="true" />
      <AlertTitle>No se pudo subir el logo</AlertTitle>
      <AlertDescription>Revisa tu conexión e inténtalo otra vez.</AlertDescription>
      <AlertAction><Button size="sm" variant="outline">Reintentar</Button></AlertAction>
    </Alert>
  ),
};
