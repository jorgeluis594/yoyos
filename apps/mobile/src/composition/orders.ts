import * as SecureStore from "expo-secure-store";
import { createOrderOperations } from "@mobile/features/orders/application/order-operations";
import { createOrderApi } from "@mobile/features/orders/infrastructure/order-api";
import { createPendingOrderConfirmationStore } from "@mobile/features/orders/infrastructure/pending-order-confirmation";
import { request } from "@mobile/composition/auth";

export const orders = createOrderOperations(createOrderApi(request), createPendingOrderConfirmationStore(SecureStore));
