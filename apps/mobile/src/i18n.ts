import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { Platform } from 'react-native';
import { translations as appTranslations } from '@mobile/home-translations';
import { translations as commonTranslations } from '@mobile/components/translations';
import { translations as userTranslations } from '@mobile/features/users/presentation/translations';
import { translations as orderTranslations } from '@mobile/features/orders/presentation/translations';
import { translations as productTranslations } from '@mobile/features/products/presentation/translations';
import { translations as printTranslations } from '@mobile/features/printing/presentation/translations';

const i18n = createInstance();
export const languageForLocale = (locale: string) => locale.toLowerCase().startsWith('pt') ? 'pt-BR' : 'es';

const resources = {
  es: { translation: {
    ...commonTranslations.es,
    ...appTranslations.es,
    ...userTranslations.es,
    ...orderTranslations.es,
    ...productTranslations.es,
    ...printTranslations.es,
  } },
  'pt-BR': { translation: {
    ...commonTranslations['pt-BR'],
    ...appTranslations['pt-BR'],
    ...userTranslations['pt-BR'],
    ...orderTranslations['pt-BR'],
    ...productTranslations['pt-BR'],
    ...printTranslations['pt-BR'],
  } },
} as const;

void i18n.use(initReactI18next).init({
  resources,
  lng: Platform.OS === 'web' ? 'es' : languageForLocale(Intl.DateTimeFormat().resolvedOptions().locale),
  fallbackLng: 'es',
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

export default i18n;
