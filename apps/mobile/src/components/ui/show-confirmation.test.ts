import { Alert } from 'react-native';

import { showConfirmation } from './show-confirmation';

test('only confirms when accepted and marks destructive confirmations', () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const onConfirm = jest.fn();
  showConfirmation({ title: 'Eliminar pedido', description: 'No se puede deshacer.', confirmLabel: 'Eliminar', cancelLabel: 'Cancelar', destructive: true, onConfirm });

  const [title, description, buttons] = alert.mock.calls[0];
  expect([title, description]).toEqual(['Eliminar pedido', 'No se puede deshacer.']);
  expect(buttons?.[0]).toMatchObject({ text: 'Cancelar', style: 'cancel' });
  expect(buttons?.[1]).toMatchObject({ text: 'Eliminar', style: 'destructive' });
  expect(onConfirm).not.toHaveBeenCalled();
  buttons?.[0].onPress?.();
  expect(onConfirm).not.toHaveBeenCalled();
  buttons?.[1].onPress?.();
  expect(onConfirm).toHaveBeenCalledTimes(1);
  alert.mockRestore();
});
