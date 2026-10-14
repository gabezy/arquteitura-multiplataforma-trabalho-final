import { Router } from "express";
import { ProductController } from "./product.controller";
import { addProductSchema, importProductsSchema, productSkuParamsSchema } from "./product.schemas";
import { validate } from "../validate";

export const productRoutes = (controller: ProductController): Router => {
    const router = Router();

    router.post('/products', validate(addProductSchema), controller.addProduct);
    router.post('/products/import', validate(importProductsSchema), controller.import);
    router.get('/products/sku/:sku', validate(productSkuParamsSchema, 'params'), controller.findProduct);

    return router;
}
