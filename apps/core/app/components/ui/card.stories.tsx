import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./card";

const meta = {
  title: "Design System/Components/Card",
  component: Card,
} satisfies Meta<typeof Card>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Complete: Story = {
  render: () => (
    <Card className="max-w-form">
      <CardHeader>
        <CardTitle>Variante 1</CardTitle>
        <CardDescription>Talla M, color caramelo</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">SKU</dt>
            <dd>POLO-M-CAR</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Precio de venta</dt>
            <dd className="tabular-nums">59.90 PEN</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Stock</dt>
            <dd className="tabular-nums">24</dd>
          </div>
        </dl>
      </CardContent>
      <CardFooter>
        <Button variant="outline" size="sm">Editar variante</Button>
      </CardFooter>
    </Card>
  ),
};

/** One coherent unit of information without header/footer structure. */
export const Simple: Story = {
  render: () => (
    <Card className="max-w-form p-4">
      <h3 className="font-medium">Variante 2</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Contenido libre dentro de una tarjeta compacta.
      </p>
    </Card>
  ),
};
