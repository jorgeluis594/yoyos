import i18n from '@mobile/i18n';
import { productErrors } from '@mobile/features/products/presentation/product-form-state';

test('server field errors use translated field labels', async () => {
  await i18n.changeLanguage('pt-BR');
  try {
    expect(productErrors({ code: 'VALIDATION_ERROR', issues: [{ field: 'salePrice', reason: 'INVALID' }] }))
      .toEqual({ salePrice: 'Confira o campo Preço de venda.' });
  } finally {
    await i18n.changeLanguage('es');
  }
});
