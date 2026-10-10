import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SymbolView } from 'expo-symbols';

import { ThemedText } from '@mobile/components/themed-text';
import { ThemedView } from '@mobile/components/themed-view';
import { Button } from '@mobile/components/ui/button';
import { ListRow } from '@mobile/components/ui/list-row';
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
          <ThemedText type="subtitle" accessibilityRole="header">{t('orders')}</ThemedText>
          <ThemedText themeColor="textSecondary">{t('homeOrdersDescription')}</ThemedText>
          <View style={[styles.actions, { backgroundColor: theme.backgroundElement }]}>
            <ListRow title={t('newOrder')} leading={<SymbolView name={{ ios: 'plus.circle', android: 'add_circle_outline' }} size={24} tintColor={theme.primary} />} onPress={() => router.push('/orders/new')} />
            <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.border }} />
            <ListRow title={t('viewOrders')} leading={<SymbolView name={{ ios: 'bag', android: 'shopping_bag' }} size={24} tintColor={theme.text} />} onPress={() => router.navigate('/orders')} />
          </View>
        </View>
        <View style={styles.section}>
          <ThemedText type="subtitle" accessibilityRole="header">{t('catalogTitle')}</ThemedText>
          <ThemedText themeColor="textSecondary">{t('catalogDescription')}</ThemedText>
          <View style={[styles.actions, { backgroundColor: theme.backgroundElement }]}>
            <ListRow title={t('viewProducts')} leading={<SymbolView name={{ ios: 'archivebox', android: 'inventory_2' }} size={24} tintColor={theme.text} />} onPress={() => router.navigate('/products')} />
            <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.border }} />
            <ListRow title={t('addProduct')} leading={<SymbolView name={{ ios: 'plus.square', android: 'add_box' }} size={24} tintColor={theme.text} />} onPress={() => router.push('/products/new')} />
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
  content: { flexGrow: 1, padding: 16, gap: 24, width: '100%', maxWidth: 640, alignSelf: 'center' },
  header: { gap: 8, paddingTop: 8 },
  section: { gap: 12 },
  actions: { borderRadius: 8, overflow: 'hidden', marginTop: 4 },
  account: { alignSelf: 'flex-start' },
});
