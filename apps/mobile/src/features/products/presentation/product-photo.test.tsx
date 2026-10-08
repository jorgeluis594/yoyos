import { fireEvent, render } from '@testing-library/react-native';
import { Alert } from 'react-native';
import i18n from '@mobile/i18n';
import { ProductPhoto } from '@mobile/features/products/presentation/product-photo';
import type { ImageId } from '@mobile/features/products/domain/product';

jest.mock('@mobile/features/products/presentation/draft-guard', () => ({ useProductDraft: () => ({ discardVersion: 0 }) }));

test('photo source chooser uses the selected language', async () => {
  await i18n.changeLanguage('pt-BR');
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  try {
    const photo = render(<ProductPhoto value={{ kind: 'keep' }} upload={jest.fn()} onChange={jest.fn()} onBusy={jest.fn()} />);
    fireEvent.press(photo.getByRole('button', { name: 'Adicionar foto do produto' }));
    expect(alert).toHaveBeenCalledWith('Foto', undefined, expect.arrayContaining([
      expect.objectContaining({ text: 'Escolher da galeria' }),
      expect.objectContaining({ text: 'Tirar foto' }),
    ]));
    photo.unmount();
  } finally {
    alert.mockRestore();
    await i18n.changeLanguage('es');
  }
});

test('removed saved photo offers restoration without a duplicate remove action', () => {
  const onChange = jest.fn();
  const photo = render(<ProductPhoto value={{ kind: 'remove' }} original={{ id: 'image-1' as ImageId, url: 'https://example.com/photo.jpg' }} upload={jest.fn()} onChange={onChange} onBusy={jest.fn()} />);
  expect(photo.queryByRole('button', { name: 'Quitar foto' })).toBeNull();
  fireEvent.press(photo.getByRole('button', { name: 'Conservar foto actual' }));
  expect(onChange).toHaveBeenCalledWith({ kind: 'keep' });
});
