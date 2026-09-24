import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import { ThemedText } from '@/components/themed-text';
import { Collapsible } from '@/components/ui/collapsible';

const meta = { title: 'UI/Collapsible', component: Collapsible, args: { title: 'Más información' } } satisfies Meta<typeof Collapsible>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: (args) => <Collapsible {...args}><ThemedText>Contenido adicional del panel.</ThemedText></Collapsible> };
