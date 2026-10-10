import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { FlatList } from 'react-native';
import { ok } from '@shared/functional';
import CatalogScreen from '@mobile/features/products/presentation/catalog-screen';
import i18n from '@mobile/i18n';

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
  expect(screen.getByRole('button', { name: 'Borrar texto de búsqueda' })).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Limpiar búsqueda' }));
  await screen.findByText('Aún no hay productos');
  expect(screen.getByLabelText('Buscar productos').props.value).toBe('');
});

const product = { id: 'product-1', name: 'Camisa de algodón de manga larga', sku: 'CAM-01', variantCount: 1, stock: 12, price: { amount: 59.9, currency: 'PEN' }, priceFrom: false };

test('product rows expose price, SKU and stock and open the product', async () => {
  mockLoadProducts.mockResolvedValue(ok({ items: [
    product,
    { ...product, id: 'product-2', name: 'Casaca denim', sku: undefined, variantCount: 3, stock: 0, priceFrom: true, photo: { id: 'image-1', url: 'https://cdn.example/casaca.webp' } },
  ], total: 2 }));
  const screen = render(<CatalogScreen />);
  await screen.findByText('Camisa de algodón de manga larga');
  expect(screen.getByText('2 productos')).toBeTruthy();
  expect(screen.getByText('12 en stock · SKU CAM-01')).toBeTruthy();
  expect(screen.getByText('Agotado')).toBeTruthy();
  expect(screen.getByText(/3 variantes/)).toBeTruthy();
  expect(screen.getByText('desde')).toBeTruthy();
  expect(screen.getAllByText(/59[.,]90/)).toHaveLength(2);
  fireEvent.press(screen.getByRole('button', { name: /Camisa de algodón/ }));
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/products/product-1'));
});

test('catalog translates empty state and search to Portuguese', async () => {
  await i18n.changeLanguage('pt-BR');
  mockLoadProducts.mockResolvedValue(ok({ items: [], total: 0 }));
  try {
    const screen = render(<CatalogScreen />);
    await screen.findByText('Ainda não há produtos');
    expect(screen.getByRole('button', { name: 'Adicionar produto' })).toBeTruthy();
    expect(screen.getByLabelText('Buscar produtos')).toBeTruthy();
    screen.unmount();
  } finally {
    await i18n.changeLanguage('es');
  }
});

test('stock filters and sort reload the catalog and explain empty filtered results', async () => {
  mockLoadProducts.mockResolvedValue(ok({ items: [product], total: 1 }));
  const screen = render(<CatalogScreen />);
  await screen.findByText('Camisa de algodón de manga larga');
  expect(mockLoadProducts).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 });

  mockLoadProducts.mockResolvedValue(ok({ items: [], total: 0 }));
  fireEvent.press(screen.getByRole('button', { name: 'Agotados' }));
  await screen.findByText('No hay productos con este filtro');
  expect(mockLoadProducts).toHaveBeenLastCalledWith({ stock: 'sold_out', page: 1, pageSize: 20 });
  expect(screen.getByRole('button', { name: 'Agotados' }).props.accessibilityState).toMatchObject({ selected: true });

  mockLoadProducts.mockResolvedValue(ok({ items: [product], total: 1 }));
  fireEvent.press(screen.getByRole('button', { name: 'Ver todos' }));
  await screen.findByText('Camisa de algodón de manga larga');
  fireEvent.press(screen.getByRole('button', { name: 'Ordenar por: Recientes' }));
  await waitFor(() => expect(mockLoadProducts).toHaveBeenLastCalledWith({ sort: 'name', page: 1, pageSize: 20 }));
  expect(await screen.findByRole('button', { name: 'Ordenar por: Nombre A–Z' })).toBeTruthy();
});

test('search combined with a stock filter offers clearing both when nothing matches', async () => {
  mockLoadProducts.mockResolvedValue(ok({ items: [], total: 0 }));
  const screen = render(<CatalogScreen />);
  await screen.findByText('Aún no hay productos');
  fireEvent.press(screen.getByRole('button', { name: 'Agotados' }));
  fireEvent.changeText(screen.getByLabelText('Buscar productos'), 'camisa');
  await screen.findByText('Sin resultados con esta búsqueda y filtro');
  expect(mockLoadProducts).toHaveBeenLastCalledWith({ search: 'camisa', stock: 'sold_out', page: 1, pageSize: 20 });
  expect(screen.queryByRole('button', { name: 'Limpiar búsqueda' })).toBeNull();

  fireEvent.press(screen.getByRole('button', { name: 'Limpiar filtros' }));
  await screen.findByText('Aún no hay productos');
  expect(mockLoadProducts).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 });
  expect(screen.getByLabelText('Buscar productos').props.value).toBe('');
  expect(screen.getByRole('button', { name: 'Todos' }).props.accessibilityState).toMatchObject({ selected: true });
});

test('a filter change clears a pull-to-refresh it supersedes', async () => {
  mockLoadProducts.mockResolvedValue(ok({ items: [product], total: 1 }));
  const screen = render(<CatalogScreen />);
  await screen.findByText('Camisa de algodón de manga larga');
  const list = () => screen.UNSAFE_getByType(FlatList);

  mockLoadProducts.mockReturnValueOnce(new Promise(() => undefined));
  act(() => { list().props.refreshControl.props.onRefresh(); });
  expect(list().props.refreshControl.props.refreshing).toBe(true);

  mockLoadProducts.mockResolvedValue(ok({ items: [], total: 0 }));
  fireEvent.press(screen.getByRole('button', { name: 'Agotados' }));
  await screen.findByText('No hay productos con este filtro');
  expect(list().props.refreshControl.props.refreshing).toBe(false);
});

test('rows with several variants show the shared variant count', async () => {
  mockLoadProducts.mockResolvedValue(ok({ items: [{ ...product, variantCount: 2 }], total: 1 }));
  const screen = render(<CatalogScreen />);
  expect(await screen.findByText('12 en stock · 2 variantes')).toBeTruthy();
});
