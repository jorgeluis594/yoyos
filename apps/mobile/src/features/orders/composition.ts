import * as SecureStore from "expo-secure-store";
import { createOrderOperations } from "@mobile/features/orders/application/order-operations";
import { createOrderApi } from "@mobile/features/orders/infrastructure/order-api";
import { createPendingOrderConfirmationStore } from "@mobile/features/orders/infrastructure/pending-order-confirmation";
import { request } from "@mobile/composition/auth";

const api = createOrderApi(request);
export const orders = { ...createOrderOperations(api, createPendingOrderConfirmationStore(SecureStore)),
  registerPayment: api.registerPayment, voidPayment: api.voidPayment, receiptUrl: api.receiptUrl };
