import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import { Textarea } from '@/components/ui/textarea';

const meta = { title: 'UI/Textarea', component: Textarea, args: { accessibilityLabel: 'Notas', value: '', onChangeText: () => {}, placeholder: 'Escribe tus notas' } } satisfies Meta<typeof Textarea>;
export default meta;
type Story = StoryObj<typeof meta>;

function Editable(props: { invalid?: boolean; disabled?: boolean }) {
  const [value, setValue] = useState('');
  return <Textarea accessibilityLabel="Notas" value={value} onChangeText={setValue} placeholder="Escribe tus notas" {...props} />;
}

export const Default: Story = { render: () => <Editable /> };
export const Invalid: Story = { render: () => <Editable invalid /> };
export const Disabled: Story = { render: () => <Editable disabled /> };
