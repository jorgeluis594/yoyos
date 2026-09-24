import { Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAccess } from '@/features/users/presentation/access-provider';

export default function HomeScreen() {
  const { state, signOut } = useAccess();
  if (state.status !== 'ready') return null;
  return <ThemedView style={styles.page}><SafeAreaView style={styles.content}>
    <ThemedText type="title">Hola, {state.user.name}</ThemedText>
    <ThemedText type="subtitle">{state.company.name}</ThemedText>
    <ThemedText themeColor="textSecondary">Tu empresa está lista.</ThemedText>
    <Pressable accessibilityRole="button" accessibilityLabel="Cerrar sesión" onPress={() => void signOut()} style={styles.button}><ThemedText type="link">Cerrar sesión</ThemedText></Pressable>
  </SafeAreaView></ThemedView>;
}

const styles = StyleSheet.create({ page: { flex: 1 }, content: { flex: 1, gap: 16, padding: 24 }, button: { minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start' } });
