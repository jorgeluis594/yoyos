import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { Platform, useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AccessProvider } from '@/features/users/presentation/access-provider';
import { AccessGate } from '@/composition/access-gate';
import * as auth from '@/composition/auth';

import '../global.css';

SplashScreen.preventAutoHideAsync();

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const [fontsLoaded, fontError] = useFonts({ Inter: require('@/assets/fonts/InterVariable.ttf') });
  if (Platform.OS !== 'web' && !fontsLoaded && !fontError) return null;
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      <AccessProvider operations={auth}><AccessGate /></AccessProvider>
    </ThemeProvider>
  );
}
