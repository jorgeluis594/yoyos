import type { Meta, StoryObj } from "@storybook/react-vite";
import { TextLink } from "./text-link";

const meta = { title: "Design System/Components/TextLink", component: TextLink } satisfies Meta<typeof TextLink>;
export default meta;
type Story = StoryObj<typeof meta>;

export const InText: Story = {
  name: "En texto",
  render: () => <p className="text-sm text-muted-foreground">¿No tienes cuenta? <TextLink href="/register">Regístrate</TextLink></p>,
};
