import { Request, Response } from 'express';
import { AddProductPort, AddProductPortInput } from "../../../core/product/port/in/create-product.port";
import { ChangePricePort, ChangePricePortInput } from "../../../core/product/port/in/change-price.port";
import { FindProductPort } from "../../../core/product/port/in/find-product.port";
import { ImportProductsPort, ImportProductsPortInput } from "../../../core/product/port/in/import-products.port";

type NoParams = Record<string, never>;

export class ProductController {

    constructor(
        private readonly addProductPort: AddProductPort,
        private readonly findProductPort: FindProductPort,
        private readonly importProductsPort: ImportProductsPort,
        private readonly changePricePort: ChangePricePort
    ) {}

    addProduct = async (req: Request<NoParams, unknown, AddProductPortInput>, res: Response): Promise<void> => {
        const product = await this.addProductPort.add(req.body);
        res.status(202).end();
    };

    import = async (req: Request<NoParams, unknown, ImportProductsPortInput>, res: Response): Promise<void> => {
        await this.importProductsPort.import(req.body);
        res.status(201).end();
    };

    findProduct = async (req: Request<{ sku: string }>, res: Response): Promise<void> => {
        const product = await this.findProductPort.find({ sku: req.params.sku });
        res.status(200).json(product);
    };

    changePrice = async (
        req: Request<{ sku: string }, unknown, Omit<ChangePricePortInput, 'sku'>>,
        res: Response
    ): Promise<void> => {
        await this.changePricePort.changePrice({ sku: req.params.sku, price: req.body.price });
        res.status(204).end();
    };

}
