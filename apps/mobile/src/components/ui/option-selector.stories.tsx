import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { OptionSelector, type OptionSelectorOption } from '@/components/ui/option-selector';

const options: OptionSelectorOption[] = [
  { value: 'basic', label: 'Básico', description: 'Para empezar.' },
  { value: 'standard', label: 'Estándar', description: 'Incluye herramientas adicionales.' },
  { value: 'premium', label: 'Premium', description: 'Acceso completo.' },
  { value: 'legacy', label: 'Clásico', disabled: true },
];
const manyOptions = [...options, { value: 'enterprise', label: 'Empresa' }];

const meta = { title: 'UI/OptionSelector', component: OptionSelector, args: { options, value: 'standard', onValueChange: () => {} } } satisfies Meta<typeof OptionSelector>;
export default meta;
type Story = StoryObj<typeof meta>;

function Example({ items = options, initial = 'standard', invalid = false, disabled = false }: { items?: OptionSelectorOption[]; initial?: string | null; invalid?: boolean; disabled?: boolean }) {
  const [value, setValue] = useState<string | null>(initial);
  return <Field invalid={invalid} disabled={disabled}><FieldLabel>Plan</FieldLabel><OptionSelector options={items} value={value} onValueChange={setValue} /><FieldError>{invalid ? 'Selecciona un plan disponible.' : ''}</FieldError></Field>;
}

export const Default: Story = { render: () => <Example /> };
export const Disabled: Story = { render: () => <Example disabled /> };
export const Invalid: Story = { render: () => <Example invalid /> };
export const FourOptions: Story = { render: () => <Example items={options} initial={null} /> };
export const FiveOptions: Story = { render: () => <Example items={manyOptions} /> };
