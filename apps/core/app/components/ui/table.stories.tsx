import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./button";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "./table";

const meta = {
  title: "Design System/Components/Table",
  component: Table,
} satisfies Meta<typeof Table>;
export default meta;

type Story = StoryObj<typeof meta>;

const items = [
  { id: "1", name: "Polo oversize", sku: "POLO-M-CAR", amount: "59.90 PEN" },
  { id: "2", name: "Casaca denim", sku: "CJ-DEN-M", amount: "189.00 PEN" },
  { id: "3", name: "Gorro tejido", sku: "GT-UNI", amount: "39.50 PEN" },
];

export const Default: Story = {
  render: () => (
    <div className="min-w-0 rounded-[var(--radius-card)] border bg-card text-card-foreground">
      <Table>
        <TableCaption>Productos del catálogo</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Nombre</TableHead>
            <TableHead>SKU</TableHead>
            <TableHead className="text-right">Precio</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="font-medium">{item.name}</TableCell>
              <TableCell className="text-muted-foreground">{item.sku}</TableCell>
              <TableCell className="text-right tabular-nums">{item.amount}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={2}>Total</TableCell>
            <TableCell className="text-right tabular-nums">288.40 PEN</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  ),
};

export const WithActions: Story = {
  name: "Con acciones",
  render: () => (
    <div className="min-w-0 rounded-[var(--radius-card)] border bg-card text-card-foreground">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nombre</TableHead>
            <TableHead>SKU</TableHead>
            <TableHead className="text-right">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="font-medium">{item.name}</TableCell>
              <TableCell className="text-muted-foreground">{item.sku}</TableCell>
              <TableCell className="text-right">
                <Button variant="ghost" size="sm">Editar</Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  ),
};
