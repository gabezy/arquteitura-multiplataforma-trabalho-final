import { Request, Response } from 'express';
import { AddProductPort, AddProductPortInput } from "../../../core/product/port/in/create-product.port";
import { FindProductPort } from "../../../core/product/port/in/find-product.port";
import { ImportProductsPort, ImportProductsPortInput } from "../../../core/product/port/in/import-products.port";

type NoParams = Record<string, never>;

export class ProductController {

    constructor(
        private readonly addProductPort: AddProductPort,
        private readonly findProductPort: FindProductPort,
        private readonly importProductsPort: ImportProductsPort
    ) {}

    addProduct = async (req: Request<NoParams, unknown, AddProductPortInput>, res: Response): Promise<void> => {
        const product = await this.addProductPort.add(req.body);
        res.status(201).location(`/products/${product.id}`).end();
    };

    import = async (req: Request<NoParams, unknown, ImportProductsPortInput>, res: Response): Promise<void> => {
        await this.importProductsPort.import(req.body);
        res.status(201).end();
    };

    findProduct = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
        const product = await this.findProductPort.find({ id: req.params.id });
        res.status(200).json(product);
    };

}
