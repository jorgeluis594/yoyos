import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';

const meta = { title: 'UI/Button', component: Button, args: { children: 'Continuar', onPress: () => {} } } satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Secondary: Story = { args: { variant: 'secondary' } };
export const Ghost: Story = { args: { variant: 'ghost' } };
export const Destructive: Story = { args: { variant: 'destructive', children: 'Eliminar' } };
export const Disabled: Story = { args: { disabled: true } };
export const Loading: Story = { args: { loading: true } };
export const AllVariants: Story = {
  render: () => <View style={{ gap: 12, maxWidth: 320 }}>
    <Button onPress={() => {}}>Continuar</Button>
    <Button variant="secondary" onPress={() => {}}>Volver</Button>
    <Button variant="ghost" onPress={() => {}}>Ver detalles</Button>
    <Button variant="destructive" onPress={() => {}}>Eliminar</Button>
  </View>,
};
