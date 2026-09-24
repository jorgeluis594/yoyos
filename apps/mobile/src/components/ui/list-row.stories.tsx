import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Text, View } from 'react-native';

import { ListRow } from '@/components/ui/list-row';

const meta = { title: 'UI/ListRow', component: ListRow, args: { title: 'Pedido #1042', onPress: () => {} } } satisfies Meta<typeof ListRow>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithDescription: Story = { args: { description: 'Creado hoy · 3 productos' } };
export const WithLeading: Story = { args: { leading: <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#E8EDF2', alignItems: 'center', justifyContent: 'center' }}><Text>📦</Text></View> } };
export const WithTrailing: Story = { args: { description: '3 productos', trailing: <Text style={{ fontWeight: '600' }}>S/ 128.00</Text> } };
