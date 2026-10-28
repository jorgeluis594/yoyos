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

test('option and combination issues and the new conflict codes read as generic messages', () => {
  expect(productErrors({ code: 'VALIDATION_ERROR', issues: [
    { scope: 'product', field: 'options', reason: 'TOO_MANY_OPTIONS' }, { scope: 'newVariant', index: 0, field: 'values', reason: 'INVALID_COMBINATION' },
  ] })).toEqual({ form: 'Revisa los datos del producto.' });
  expect(productErrors({ code: 'VALIDATION_ERROR', issues: [{ scope: 'newVariant', index: 1, field: 'sku', reason: 'DUPLICATE_SKU' }] }))
    .toEqual({ sku: 'Este SKU ya está en uso.' });
  for (const code of ['ID_CONFLICT', 'DUPLICATE_COMBINATION', 'VARIANT_HAS_ORDERS']) expect(productErrors({ code })).toEqual({ form: 'Revisa los datos del producto.' });
});

test('a stale save keeps the form and offers to reload the product', () => {
  expect(productErrors({ code: 'PRODUCT_CHANGED' })).toEqual({ form: 'Este producto cambió desde que lo abriste. Recarga el producto para ver los cambios.' });
});
