import { Router } from "express";
import { ProductController } from "./product.controller";
import { addProductSchema, changePriceBodySchema, importProductsSchema, productSkuParamsSchema } from "./product.schemas";
import { validate } from "../validate";

export const productRoutes = (controller: ProductController): Router => {
    const router = Router();

    router.post('/products', validate(addProductSchema), controller.addProduct);
    router.post('/products/import', validate(importProductsSchema), controller.import);
    router.get('/products/sku/:sku', validate(productSkuParamsSchema, 'params'), controller.findProduct);
    router.patch(
        '/products/sku/:sku/price',
        validate(productSkuParamsSchema, 'params'),
        validate(changePriceBodySchema),
        controller.changePrice,
    );

    return router;
}
