import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import { ActionMenu } from '@/components/ui/action-menu';

const meta = { title: 'UI/ActionMenu', component: ActionMenu, args: { actions: [
  { id: 'edit', label: 'Editar', onSelect: () => {} },
  { id: 'delete', label: 'Eliminar', destructive: true, onSelect: () => {} },
] } } satisfies Meta<typeof ActionMenu>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
