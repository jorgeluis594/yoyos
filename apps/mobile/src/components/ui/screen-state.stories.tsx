import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import { Button } from '@/components/ui/button';
import { ScreenState } from '@/components/ui/screen-state';

const meta = { title: 'UI/ScreenState', component: ScreenState, args: { status: 'loading', title: 'Cargando pedidos', description: 'Estamos preparando tu lista.' } } satisfies Meta<typeof ScreenState>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {};
export const Empty: Story = { args: { status: 'empty', title: 'Aún no tienes pedidos', description: 'Cuando registres tu primer pedido, aparecerá aquí.', action: <Button onPress={() => {}}>Crear pedido</Button> } };
export const NoResults: Story = { args: { status: 'no-results', title: 'No encontramos pedidos', description: 'Prueba con otro término o quita los filtros de búsqueda.', action: <Button variant="secondary" onPress={() => {}}>Limpiar búsqueda</Button> } };
export const Error: Story = { args: { status: 'error', title: 'No pudimos cargar tus pedidos', description: 'Revisa tu conexión e inténtalo de nuevo.', onRetry: () => {} } };
