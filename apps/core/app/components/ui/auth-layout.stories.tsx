import type { Meta, StoryObj } from "@storybook/react-vite";
import { AuthLayout, AuthLayoutDescription, AuthLayoutFooter, AuthLayoutHeader, AuthLayoutTitle } from "./auth-layout";
import { Button } from "./button";
import { Field, FieldLabel } from "./field";
import { Input } from "./input";
import { TextLink } from "./text-link";

const meta = { title: "Design System/Layout/AuthLayout", component: AuthLayout, parameters: { layout: "fullscreen" } } satisfies Meta<typeof AuthLayout>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Login: Story = {
  render: () => (
    <AuthLayout>
      <AuthLayoutHeader>
        <AuthLayoutTitle>Iniciar sesión</AuthLayoutTitle>
        <AuthLayoutDescription>Entra para gestionar tus ventas.</AuthLayoutDescription>
      </AuthLayoutHeader>
      <form className="flex flex-col gap-4">
        <Field><FieldLabel htmlFor="email">Correo</FieldLabel><Input id="email" type="email" /></Field>
        <Button type="submit">Entrar</Button>
      </form>
      <AuthLayoutFooter>
        <p>¿No tienes cuenta? <TextLink href="/register">Regístrate</TextLink></p>
        <TextLink href="/forgot-password">Olvidé mi contraseña</TextLink>
      </AuthLayoutFooter>
    </AuthLayout>
  ),
};
