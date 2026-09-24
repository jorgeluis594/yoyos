import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import { Input } from '@/components/ui/input';

const meta = { title: 'UI/Input', component: Input, args: { accessibilityLabel: 'Nombre', value: '', onChangeText: () => {}, placeholder: 'Escribe tu nombre' } } satisfies Meta<typeof Input>;
export default meta;
type Story = StoryObj<typeof meta>;

function Editable(props: { invalid?: boolean; disabled?: boolean }) {
  const [value, setValue] = useState('');
  return <Input accessibilityLabel="Nombre" value={value} onChangeText={setValue} placeholder="Escribe tu nombre" {...props} />;
}

export const Default: Story = { render: () => <Editable /> };
export const Invalid: Story = { render: () => <Editable invalid /> };
export const Disabled: Story = { render: () => <Editable disabled /> };
