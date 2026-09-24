import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

const meta = { title: 'Themed/View', component: ThemedView } satisfies Meta<typeof ThemedView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Surfaces: Story = { render: () => <View style={{ gap: 12, maxWidth: 400 }}>
  <ThemedView style={{ padding: 20 }}><ThemedText>Fondo principal</ThemedText></ThemedView>
  <ThemedView type="backgroundElement" style={{ padding: 20 }}><ThemedText>Superficie de elemento</ThemedText></ThemedView>
  <ThemedView type="backgroundSelected" style={{ padding: 20 }}><ThemedText>Superficie seleccionada</ThemedText></ThemedView>
</View> };
