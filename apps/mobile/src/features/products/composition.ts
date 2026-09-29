import { createProductOperations } from "@mobile/features/products/application/product-operations";
import { createProductApi } from "@mobile/features/products/infrastructure/product-api";
import { request } from "@mobile/composition/auth";

export const products = createProductOperations(createProductApi(request));
