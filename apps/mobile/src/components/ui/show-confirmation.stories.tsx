import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import { Button } from '@/components/ui/button';
import { showConfirmation } from '@/components/ui/show-confirmation';

const meta = { title: 'UI/ShowConfirmation', component: Button, args: { children: 'Eliminar pedido', onPress: () => showConfirmation({ title: 'Eliminar pedido', description: 'No se puede deshacer.', confirmLabel: 'Eliminar', cancelLabel: 'Cancelar', destructive: true, onConfirm: () => {} }) } } satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
