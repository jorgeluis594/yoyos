import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { ThemedText } from '@mobile/components/themed-text';
import { ThemedView } from '@mobile/components/themed-view';
import { Button } from '@mobile/components/ui/button';
import { useAccess } from '@mobile/features/users/presentation/access-provider';
import { useTheme } from '@mobile/hooks/use-theme';

export default function HomeScreen() {
  const { state, signOut } = useAccess();
  const router = useRouter();
  const theme = useTheme();
  const { t } = useTranslation();
  if (state.status !== 'ready') return null;

  return <ThemedView style={styles.page}>
    <SafeAreaView style={styles.page} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <ThemedText type="title" accessibilityRole="header">{state.company.name}</ThemedText>
          <ThemedText themeColor="textSecondary">{t('greeting', { name: state.user.name })}</ThemedText>
        </View>
        <View style={styles.section}>
          <ThemedText type="subtitle" accessibilityRole="header">{t('catalogTitle')}</ThemedText>
          <ThemedText themeColor="textSecondary">{t('catalogDescription')}</ThemedText>
          <View style={[styles.actions, { backgroundColor: theme.backgroundElement }]}>
            <Button onPress={() => router.navigate('/products')}>{t('viewProducts')}</Button>
            <Button variant="secondary" onPress={() => router.push('/products/new')}>{t('addProduct')}</Button>
          </View>
        </View>
        <View style={styles.account}>
          <Button variant="ghost" onPress={() => void signOut()}>{t('signOut')}</Button>
        </View>
      </ScrollView>
    </SafeAreaView>
  </ThemedView>;
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { flexGrow: 1, padding: 16, gap: 32, width: '100%', maxWidth: 640, alignSelf: 'center' },
  header: { gap: 8, paddingTop: 8 },
  section: { gap: 12 },
  actions: { padding: 16, gap: 12, borderRadius: 8, marginTop: 4 },
  account: { marginTop: 'auto', alignSelf: 'flex-start', paddingTop: 24 },
});
