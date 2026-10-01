import { render } from '@testing-library/react-native';
import i18n from '@mobile/i18n';
import { ProductPhoto } from '@mobile/features/products/presentation/product-photo';

jest.mock('@mobile/features/products/presentation/draft-guard', () => ({ useProductDraft: () => ({ discardVersion: 0 }) }));

test('photo actions use the selected language', async () => {
  await i18n.changeLanguage('pt-BR');
  try {
    const photo = render(<ProductPhoto value={{ kind: 'keep' }} upload={jest.fn()} onChange={jest.fn()} onBusy={jest.fn()} />);
    expect(photo.getByText('Sem foto')).toBeTruthy();
    expect(photo.getByRole('button', { name: 'Escolher da galeria' })).toBeTruthy();
    photo.unmount();
  } finally {
    await i18n.changeLanguage('es');
  }
});
