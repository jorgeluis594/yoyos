import { createProductOperations } from "@/features/products/application/product-operations";
import { createProductApi } from "@/features/products/infrastructure/product-api";
import { request } from "./auth";

export const products = createProductOperations(createProductApi(request));
