import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { Platform } from 'react-native';
import { translations as appTranslations } from '@mobile/home-translations';
import { translations as commonTranslations } from '@mobile/components/translations';
import { translations as userTranslations } from '@mobile/features/users/presentation/translations';
import { translations as orderTranslations } from '@mobile/features/orders/presentation/translations';
import { orderDetailTranslations } from '@mobile/features/orders/presentation/order-detail-translations';
import { translations as productTranslations } from '@mobile/features/products/presentation/translations';
import { translations as deliverySettingsTranslations } from '@mobile/features/delivery-settings/presentation/translations';
import { translations as whatsappTranslations } from '@mobile/features/whatsapp/presentation/translations';
import { translations as printTranslations } from '@mobile/features/printing/presentation/translations';

const i18n = createInstance();
export const languageForLocale = (locale: string) => locale.toLowerCase().startsWith('pt') ? 'pt-BR' : 'es';

const resources = {
  es: { translation: {
    ...commonTranslations.es,
    ...appTranslations.es,
    ...userTranslations.es,
    ...orderTranslations.es,
    ...orderDetailTranslations.es,
    viewCheckoutLink: 'Ver enlace',
    ...productTranslations.es,
    ...printTranslations.es,
    ...deliverySettingsTranslations.es,
    ...whatsappTranslations.es,
  } },
  'pt-BR': { translation: {
    ...commonTranslations['pt-BR'],
    ...appTranslations['pt-BR'],
    ...userTranslations['pt-BR'],
    ...orderTranslations['pt-BR'],
    ...orderDetailTranslations['pt-BR'],
    viewCheckoutLink: 'Ver link',
    ...productTranslations['pt-BR'],
    ...printTranslations['pt-BR'],
    ...deliverySettingsTranslations['pt-BR'],
    ...whatsappTranslations['pt-BR'],
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
