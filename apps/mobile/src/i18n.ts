import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { Platform } from 'react-native';
import { translations as appTranslations } from '@mobile/home-translations';
import { translations as commonTranslations } from '@mobile/components/translations';
import { translations as userTranslations } from '@mobile/features/users/presentation/translations';
import { translations as orderTranslations } from '@mobile/features/orders/presentation/translations';
import { orderDetailTranslations } from '@mobile/features/orders/presentation/order-detail-translations';
import { orderReviewTranslations } from '@mobile/features/orders/presentation/order-review-translations';
import { translations as productTranslations } from '@mobile/features/products/presentation/translations';
import { translations as deliverySettingsTranslations } from '@mobile/features/delivery-settings/presentation/translations';
import { translations as catalogTranslations } from '@mobile/features/catalog/presentation/translations';
import { translations as storeAppearanceTranslations } from '@mobile/features/store-appearance/presentation/translations';
import { translations as whatsappTranslations } from '@mobile/features/whatsapp/presentation/translations';
import { translations as noticeTranslations } from '@mobile/features/notifications/presentation/translations';
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
    ...orderReviewTranslations.es,
    ...productTranslations.es,
    ...printTranslations.es,
    ...deliverySettingsTranslations.es,
    ...catalogTranslations.es,
    ...storeAppearanceTranslations.es,
    ...whatsappTranslations.es,
    ...noticeTranslations.es,
  } },
  'pt-BR': { translation: {
    ...commonTranslations['pt-BR'],
    ...appTranslations['pt-BR'],
    ...userTranslations['pt-BR'],
    ...orderTranslations['pt-BR'],
    ...orderDetailTranslations['pt-BR'],
    ...orderReviewTranslations['pt-BR'],
    ...productTranslations['pt-BR'],
    ...printTranslations['pt-BR'],
    ...deliverySettingsTranslations['pt-BR'],
    ...catalogTranslations['pt-BR'],
    ...storeAppearanceTranslations['pt-BR'],
    ...whatsappTranslations['pt-BR'],
    ...noticeTranslations['pt-BR'],
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
