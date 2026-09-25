import type { ComponentType } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router";
import { AuthForm } from "./auth-form";

const meta = {
  title: "Design System/Patterns/Auth",
  component: AuthForm,
  decorators: [
    (Story: ComponentType) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
} satisfies Meta<typeof AuthForm>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Login: Story = {
  name: "Iniciar sesión",
  args: { mode: "login" },
};

export const Register: Story = {
  name: "Crear cuenta",
  args: { mode: "register" },
};

export const CompanyStep: Story = {
  name: "Crear empresa",
  args: { mode: "register", pendingCompany: true },
};
