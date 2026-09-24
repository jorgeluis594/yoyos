import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

const meta = { title: 'UI/Field', component: Field } satisfies Meta<typeof Field>;
export default meta;
type Story = StoryObj<typeof meta>;

function Fields({ invalid = false, disabled = false, horizontal = false }: { invalid?: boolean; disabled?: boolean; horizontal?: boolean }) {
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  return <FieldGroup style={{ maxWidth: 480 }}>
    <Field required invalid={invalid} disabled={disabled} orientation={horizontal ? 'horizontal' : 'vertical'}>
      <FieldLabel>Nombre</FieldLabel>
      <Input value={name} onChangeText={setName} placeholder="Escribe tu nombre" />
      <FieldDescription>Como aparecerá en tu perfil.</FieldDescription>
      {invalid && <FieldError>Ingresa un nombre válido.</FieldError>}
    </Field>
    <Field disabled={disabled}>
      <FieldLabel>Notas</FieldLabel>
      <Textarea value={notes} onChangeText={setNotes} placeholder="Agrega detalles" />
    </Field>
  </FieldGroup>;
}

export const Default: Story = { render: () => <Fields /> };
export const Invalid: Story = { render: () => <Fields invalid /> };
export const Disabled: Story = { render: () => <Fields disabled /> };
export const Horizontal: Story = { render: () => <Fields horizontal /> };
