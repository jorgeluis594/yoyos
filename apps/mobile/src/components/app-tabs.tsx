import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useColorScheme } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Colors } from '@mobile/constants/theme';
import { showConfirmation } from '@mobile/components/ui/show-confirmation';
import { useProductDraft } from '@mobile/features/products/presentation/draft-guard';
import { useOrderDraft } from '@mobile/features/orders/presentation/order-draft-guard';
import { useAccess } from '@mobile/features/users/presentation/access-provider';

export default function AppTabs() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'unspecified' ? 'light' : scheme];
  const router = useRouter();
  const pathname = usePathname();
  const { dirty, discard } = useProductDraft();
  const orderDraft = useOrderDraft();
  const { state } = useAccess();
  const { t } = useTranslation();
  const tabPress = (path: '/' | '/products' | '/orders' | '/settings') => (event: { data: { isPrevented: boolean } }) => {
    const isCurrentTab = path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(`${path}/`);
    if (!event.data.isPrevented || (!dirty && !orderDraft.dirty) || isCurrentTab) return;
    showConfirmation({
      title: t('discardChanges'),
      description: t('discardDescription'),
      confirmLabel: t('discard'),
      cancelLabel: t('keepEditing'),
      destructive: true,
      onConfirm: () => { if (dirty) discard(); if (orderDraft.dirty) orderDraft.discard(); router.navigate(path); },
    });
  };

  return (
    <NativeTabs
      backgroundColor={colors.background}
      tintColor={colors.primary}
      iconColor={{ default: colors.textSecondary, selected: colors.primary }}
      indicatorColor={colors.backgroundSelected}
      labelStyle={{ default: { color: colors.textSecondary }, selected: { color: colors.primary } }}>
      <NativeTabs.Trigger name="index" disabled={dirty || orderDraft.dirty} listeners={{ tabPress: tabPress('/') }}>
        <NativeTabs.Trigger.Label>{t('home')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: "house", selected: "house.fill" }}
          md="home"
        />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="products" disabled={dirty || orderDraft.dirty} listeners={{ tabPress: tabPress('/products') }}>
        <NativeTabs.Trigger.Label>{t('products')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="shippingbox" md="inventory_2" />
      </NativeTabs.Trigger>
      {state.status === 'ready' ? <NativeTabs.Trigger name="orders" disabled={dirty || orderDraft.dirty} listeners={{ tabPress: tabPress('/orders') }}>
        <NativeTabs.Trigger.Label>{t('orders')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="bag" md="shopping_bag" />
      </NativeTabs.Trigger> : null}
      {state.status === 'ready' ? <NativeTabs.Trigger name="settings" disabled={dirty || orderDraft.dirty} listeners={{ tabPress: tabPress('/settings') }}>
        <NativeTabs.Trigger.Label>{t('deliverySettingsNav')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="gearshape" md="settings" />
      </NativeTabs.Trigger> : null}
    </NativeTabs>
  );
}
