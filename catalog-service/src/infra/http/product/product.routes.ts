import { Router } from "express";
import { ProductController } from "./product.controller";

export const productRoutes = (controller: ProductController): Router => {
    const router = Router();

    router.post('/products', controller.addProduct);
    router.post('/products/import', controller.import);
    router.get('/products/:id', controller.findProduct);

    return router;
}
