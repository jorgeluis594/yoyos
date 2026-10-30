import type { Meta, StoryObj } from "@storybook/react-vite";
import { Field, FieldLabel } from "./field";
import { PasswordInput } from "./password-input";

const meta = {
  title: "Design System/Components/Password input",
  component: PasswordInput,
} satisfies Meta<typeof PasswordInput>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="max-w-form">
      <PasswordInput name="password" defaultValue="secreto123" aria-label="Contraseña" autoComplete="current-password" />
    </div>
  ),
};

export const WithField: Story = {
  name: "Dentro de Field",
  render: () => (
    <div className="max-w-form">
      <Field>
        <FieldLabel htmlFor="story-password">Contraseña</FieldLabel>
        <PasswordInput id="story-password" name="password" autoComplete="new-password" minLength={8} maxLength={128} />
      </Field>
    </div>
  ),
};

export const Invalid: Story = {
  name: "Inválido",
  render: () => (
    <div className="max-w-form">
      <PasswordInput name="password" aria-invalid defaultValue="corta" aria-label="Contraseña" />
    </div>
  ),
};
