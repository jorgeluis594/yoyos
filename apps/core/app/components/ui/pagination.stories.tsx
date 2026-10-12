import type { Meta, StoryObj } from "@storybook/react-vite";
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "./pagination";

const meta = { title: "Design System/Components/Pagination", component: Pagination } satisfies Meta<typeof Pagination>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Numbered: Story = {
  name: "Numerada",
  render: () => (
    <Pagination aria-label="Páginas de productos" className="justify-start">
      <PaginationContent>
        {[1, 2, 3].map((page) => <PaginationItem key={page}><PaginationLink href={`?page=${page}`} isActive={page === 2} aria-label={`Página ${page}`}>{page}</PaginationLink></PaginationItem>)}
      </PaginationContent>
    </Pagination>
  ),
};

export const PreviousNext: Story = {
  name: "Anterior / siguiente",
  render: () => (
    <Pagination aria-label="Páginas de pedidos">
      <PaginationContent className="w-full justify-end">
        <PaginationItem className="mr-auto text-sm text-muted-foreground">Página 2</PaginationItem>
        <PaginationItem><PaginationPrevious href="?page=1">Anterior</PaginationPrevious></PaginationItem>
        <PaginationItem><PaginationNext href="?page=3">Siguiente</PaginationNext></PaginationItem>
      </PaginationContent>
    </Pagination>
  ),
};
