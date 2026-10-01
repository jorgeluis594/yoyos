import i18n from './i18n';

test('translates navigation and interpolated greetings for both supported languages', async () => {
  await i18n.changeLanguage('es');
  expect(i18n.t('products')).toBe('Productos');
  expect(i18n.t('greeting', { name: 'Ana' })).toBe('Hola, Ana');
  await i18n.changeLanguage('pt-BR');
  expect(i18n.t('products')).toBe('Produtos');
  expect(i18n.t('greeting', { name: 'Ana' })).toBe('Olá, Ana');
  await i18n.changeLanguage('es');
});
