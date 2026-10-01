import i18n, { languageForLocale } from './i18n';

test('translates navigation and interpolated greetings for both supported languages', async () => {
  await i18n.changeLanguage('es');
  expect(i18n.t('products')).toBe('Productos');
  expect(i18n.t('greeting', { name: 'Ana' })).toBe('Hola, Ana');
  await i18n.changeLanguage('pt-BR');
  expect(i18n.t('products')).toBe('Produtos');
  expect(i18n.t('greeting', { name: 'Ana' })).toBe('Olá, Ana');
  await i18n.changeLanguage('es');
});

test('Spanish and Portuguese catalogs contain the same keys', () => {
  expect(Object.keys(i18n.getResourceBundle('es', 'translation')).sort())
    .toEqual(Object.keys(i18n.getResourceBundle('pt-BR', 'translation')).sort());
});

test('Portuguese device locales select Brazilian Portuguese', () => {
  expect(languageForLocale('pt-PT')).toBe('pt-BR');
  expect(languageForLocale('en-US')).toBe('es');
});
