import { useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button, type ButtonProps } from '@/components/ui/button';
import { ListRow } from '@/components/ui/list-row';
import { BottomTabInset, MaxContentWidth } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const variants = [
  { name: 'Principal', variant: 'default' },
  { name: 'Secundario', variant: 'secondary' },
  { name: 'Fantasma', variant: 'ghost' },
  { name: 'Destructivo', variant: 'destructive' },
] as const satisfies readonly { name: string; variant: ButtonProps['variant'] }[];

export default function ExploreScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [lastAction, setLastAction] = useState('Ninguna');

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentInset={{ ...insets, bottom: insets.bottom + BottomTabInset }}
      contentContainerStyle={[
        styles.content,
        Platform.OS === 'android' && {
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + BottomTabInset + 24,
          paddingHorizontal: insets.left + 16,
        },
      ]}
    >
      <View style={styles.container}>
        <ThemedText type="subtitle">Botones</ThemedText>
        <ThemedText themeColor="textSecondary">Variantes y estados del botón móvil.</ThemedText>
        <ThemedText>Última acción: {lastAction}</ThemedText>
        {variants.map(({ name, variant }) => (
          <View key={variant} style={styles.section}>
            <ThemedText type="smallBold">{name}</ThemedText>
            <Button variant={variant} onPress={() => setLastAction(name)}>{name}</Button>
            <Button variant={variant} disabled onPress={() => setLastAction(name)}>Deshabilitado</Button>
            <Button variant={variant} loading onPress={() => setLastAction(name)}>Cargando</Button>
          </View>
        ))}
        <View style={styles.section}>
          <ThemedText type="smallBold">Texto ampliado</ThemedText>
          <Button onPress={() => setLastAction('Texto largo')}>
            {'Continuar con una acción que ocupa varias líneas cuando el texto crece'}
          </Button>
        </View>
        <View style={styles.section}>
          <ThemedText type="subtitle">Fila de lista</ThemedText>
          <ListRow title="Pedido #1042" description="Creado hoy · 3 productos" onPress={() => setLastAction('Pedido #1042')} />
          <ListRow title="Café de origen" description="Producto disponible" trailing={<ThemedText type="smallBold">S/ 24.90</ThemedText>} onPress={() => setLastAction('Café de origen')} />
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { alignItems: 'center', paddingHorizontal: 16, paddingVertical: 24 },
  container: { width: '100%', maxWidth: MaxContentWidth, gap: 12 },
  section: { gap: 8, marginTop: 16 },
});
