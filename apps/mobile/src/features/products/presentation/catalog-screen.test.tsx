import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ok } from '@shared/functional';
import CatalogScreen from '@mobile/features/products/presentation/catalog-screen';

const mockPush = jest.fn();
const mockLoadProducts = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (callback: () => void) => jest.requireActual('react').useEffect(callback, [callback]),
}));
jest.mock('@mobile/features/products/composition', () => ({ products: { loadProducts: (...args: unknown[]) => mockLoadProducts(...args) } }));
jest.mock('@mobile/features/users/presentation/access-provider', () => ({
  useAccess: () => ({ state: { status: 'ready', company: { name: 'Mi tienda' } } }),
}));
jest.mock('@mobile/features/printing/presentation/print-provider', () => ({ usePrint: () => ({ showPrinterPicker: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: jest.requireActual('react-native').View }));

beforeEach(() => { jest.clearAllMocks(); });

test('creation remains available with an empty catalog and without search results', async () => {
  mockLoadProducts.mockResolvedValue(ok({ items: [], total: 0 }));
  const screen = render(<CatalogScreen />);
  await screen.findByText('Aún no hay productos');
  fireEvent.press(screen.getByRole('button', { name: 'Agregar producto' }));
  expect(mockPush).toHaveBeenCalledWith('/products/new');

  fireEvent.changeText(screen.getByLabelText('Buscar productos'), 'camisa');
  await screen.findByText('Sin resultados');
  expect(screen.getByRole('button', { name: 'Agregar producto' })).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Limpiar búsqueda' }));
  await screen.findByText('Aún no hay productos');
  expect(screen.getByLabelText('Buscar productos').props.value).toBe('');
});

test('product rows expose price, SKU and stock and open the product', async () => {
  mockLoadProducts.mockResolvedValue(ok({ items: [{ id: 'product-1', name: 'Camisa de algodón de manga larga', sku: 'CAM-01', variantCount: 1, stock: 12, price: { amount: 59.9, currency: 'PEN' }, priceFrom: false }], total: 1 }));
  const screen = render(<CatalogScreen />);
  await screen.findByText('Camisa de algodón de manga larga');
  expect(screen.getByText('SKU CAM-01')).toBeTruthy();
  expect(screen.getByText('Stock: 12')).toBeTruthy();
  expect(screen.getByText(/59[.,]90/)).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: /Camisa de algodón/ }));
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/products/product-1'));
});
