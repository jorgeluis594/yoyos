import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';

const meta = { title: 'Themed/Text', component: ThemedText, args: { children: 'Texto de ejemplo' } } satisfies Meta<typeof ThemedText>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const AllTypes: Story = { render: () => <View style={{ gap: 12 }}>
  <ThemedText type="title">Título</ThemedText>
  <ThemedText type="subtitle">Subtítulo</ThemedText>
  <ThemedText>Texto principal</ThemedText>
  <ThemedText type="small">Texto pequeño</ThemedText>
  <ThemedText type="smallBold">Texto pequeño destacado</ThemedText>
  <ThemedText type="link">Enlace</ThemedText>
  <ThemedText type="linkPrimary">Enlace principal</ThemedText>
  <ThemedText type="code">const valor = 1;</ThemedText>
</View> };
