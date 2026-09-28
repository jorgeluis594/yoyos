import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useColorScheme } from 'react-native';
import { usePathname, useRouter } from 'expo-router';

import { Colors } from '@mobile/constants/theme';
import { showConfirmation } from '@mobile/components/ui/show-confirmation';
import { useProductDraft } from '@mobile/features/products/presentation/draft-guard';

export default function AppTabs() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'unspecified' ? 'light' : scheme];
  const router = useRouter();
  const pathname = usePathname();
  const { dirty, discard } = useProductDraft();
  const tabPress = (path: '/' | '/products') => (event: { data: { isPrevented: boolean } }) => {
    const isCurrentTab = path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(`${path}/`);
    if (!event.data.isPrevented || !dirty || isCurrentTab) return;
    showConfirmation({
      title: '¿Descartar cambios?',
      description: 'Se perderán los cambios que no guardaste.',
      confirmLabel: 'Descartar',
      cancelLabel: 'Seguir editando',
      destructive: true,
      onConfirm: () => { discard(); router.navigate(path); },
    });
  };

  return (
    <NativeTabs
      backgroundColor={colors.background}
      tintColor={colors.primary}
      iconColor={{ default: colors.textSecondary, selected: colors.primary }}
      indicatorColor={colors.backgroundSelected}
      labelStyle={{ default: { color: colors.textSecondary }, selected: { color: colors.primary } }}>
      <NativeTabs.Trigger name="index" disabled={dirty} listeners={{ tabPress: tabPress('/') }}>
        <NativeTabs.Trigger.Label>Inicio</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: "house", selected: "house.fill" }}
          md="home"
        />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="products" disabled={dirty} listeners={{ tabPress: tabPress('/products') }}>
        <NativeTabs.Trigger.Label>Productos</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="shippingbox" md="inventory_2" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
