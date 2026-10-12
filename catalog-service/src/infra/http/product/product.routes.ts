import { Router } from "express";
import { ProductController } from "./product.controller";
import { addProductSchema, importProductsSchema, productIdParamsSchema } from "./product.schemas";
import { validate } from "../validate";

export const productRoutes = (controller: ProductController): Router => {
    const router = Router();

    router.post('/products', validate(addProductSchema), controller.addProduct);
    router.post('/products/import', validate(importProductsSchema), controller.import);
    router.get('/products/:id', validate(productIdParamsSchema, 'params'), controller.findProduct);

    return router;
}
