import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { Platform, useColorScheme } from 'react-native';
import { useEffect } from 'react';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AccessProvider } from '@/features/users/presentation/access-provider';
import { PrintProvider } from '@mobile/features/printing/presentation/print-provider';
import { ProductDraftProvider } from '@/features/products/presentation/draft-guard';
import { OrderDraftProvider } from '@mobile/features/orders/presentation/order-draft-guard';
import { AccessGate } from '@/composition/access-gate';
import * as auth from '@/composition/auth';
import i18n, { languageForLocale } from '@mobile/i18n';
import { openWhatsAppDatabase } from '@mobile/features/whatsapp/infrastructure/local-database';

import '../global.css';

SplashScreen.preventAutoHideAsync();

export default function TabLayout() {
  useEffect(() => {
    if (Platform.OS === 'web') void i18n.changeLanguage(languageForLocale(Intl.DateTimeFormat().resolvedOptions().locale));
    else void openWhatsAppDatabase().catch(() => console.error('WhatsApp database initialization failed'));
  }, []);
  const colorScheme = useColorScheme();
  const [fontsLoaded, fontError] = useFonts({ Inter: require('@/assets/fonts/InterVariable.ttf') });
  if (Platform.OS !== 'web' && !fontsLoaded && !fontError) return null;
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      <ProductDraftProvider><OrderDraftProvider><AccessProvider operations={auth}><PrintProvider><AccessGate /></PrintProvider></AccessProvider></OrderDraftProvider></ProductDraftProvider>
    </ThemeProvider>
  );
}
