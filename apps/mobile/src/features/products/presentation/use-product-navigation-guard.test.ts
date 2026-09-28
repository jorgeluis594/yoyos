import { act, renderHook } from "@testing-library/react-native";
import { useProductNavigationGuard } from "@mobile/features/products/presentation/use-product-navigation-guard";

const mockDispatch = jest.fn();
const mockDiscard = jest.fn();
const mockSetDirty = jest.fn();
const mockShowConfirmation = jest.fn();
const mockUsePreventRemove = jest.fn();

jest.mock("expo-router", () => ({ useNavigation: () => ({ dispatch: mockDispatch }) }));
jest.mock("expo-router/react-navigation", () => ({ usePreventRemove: (...args: unknown[]) => mockUsePreventRemove(...args) }));
jest.mock("@mobile/components/ui/show-confirmation", () => ({ showConfirmation: (...args: unknown[]) => mockShowConfirmation(...args) }));
jest.mock("@mobile/features/products/presentation/draft-guard", () => ({
  useProductDraft: () => ({ setDirty: mockSetDirty, discard: mockDiscard, discardVersion: 0 }),
}));

beforeEach(() => jest.clearAllMocks());

test("keeps a dirty product form visible until discard is confirmed", () => {
  renderHook(() => useProductNavigationGuard(true));
  expect(mockUsePreventRemove).toHaveBeenLastCalledWith(true, expect.any(Function));
  const onPreventRemove = mockUsePreventRemove.mock.lastCall?.[1];
  const action = { type: "GO_BACK" };

  act(() => onPreventRemove({ data: { action } }));
  expect(mockDispatch).not.toHaveBeenCalled();
  expect(mockShowConfirmation).toHaveBeenCalledWith(expect.objectContaining({ cancelLabel: "Seguir editando" }));

  act(() => mockShowConfirmation.mock.lastCall?.[0].onConfirm());
  expect(mockDiscard).toHaveBeenCalledTimes(1);
  expect(mockDispatch).toHaveBeenCalledWith(action);
});

test("continues navigation immediately after changes were saved", () => {
  const { result } = renderHook(() => useProductNavigationGuard(true));
  const onPreventRemove = mockUsePreventRemove.mock.lastCall?.[1];
  const action = { type: "REPLACE" };

  act(() => result.current(false));
  act(() => onPreventRemove({ data: { action } }));
  expect(mockShowConfirmation).not.toHaveBeenCalled();
  expect(mockDispatch).toHaveBeenCalledWith(action);
});
