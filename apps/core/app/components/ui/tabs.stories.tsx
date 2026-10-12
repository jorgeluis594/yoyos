import type { Meta, StoryObj } from "@storybook/react-vite";
import { Package, Store, Truck } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

const meta = { title: "Design System/Components/Tabs", component: Tabs } satisfies Meta<typeof Tabs>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Tabs defaultValue="edit" className="max-w-form">
      <TabsList className="w-full">
        <TabsTrigger value="edit">Editar</TabsTrigger>
        <TabsTrigger value="preview">Vista previa</TabsTrigger>
      </TabsList>
      <TabsContent value="edit">Panel de edición.</TabsContent>
      <TabsContent value="preview">Vista previa del checkout.</TabsContent>
    </Tabs>
  ),
};

export const Line: Story = {
  render: () => (
    <Tabs defaultValue="store" className="max-w-form">
      <TabsList variant="line" className="w-full">
        <TabsTrigger value="store"><Store data-icon="inline-start" aria-hidden="true" />Tienda</TabsTrigger>
        <TabsTrigger value="home"><Truck data-icon="inline-start" aria-hidden="true" />Domicilio</TabsTrigger>
        <TabsTrigger value="agency"><Package data-icon="inline-start" aria-hidden="true" />Agencia</TabsTrigger>
      </TabsList>
      <TabsContent value="store">Recojo en tienda.</TabsContent>
      <TabsContent value="home">Envío a domicilio.</TabsContent>
      <TabsContent value="agency">Envío por agencia.</TabsContent>
    </Tabs>
  ),
};
