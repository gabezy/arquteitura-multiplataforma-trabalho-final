import { z } from 'zod';
import {
    ProductNotApprovedError,
    ProductNotFoundError,
    ProductRequestRefusedError,
} from '../../core/listing/model/listing.errors';
import { CatalogProduct, ProductCatalogPort } from '../../core/listing/port/out/product-catalog.port';

const productSchema = z.object({
    sku: z.string().min(1),
    name: z.string(),
    description: z.string(),
    price: z.number(),
    stock: z.number().int(),
    analysisStatus: z.string(),
});

const APPROVED = 'APPROVED';
const REQUEST_TIMEOUT = 408;
const TOO_MANY_REQUESTS = 429;
const SERVER_ERROR = 500;
const NOT_FOUND = 404;

// The catalog does not answer, or answers something that may change: the message is delivered again.
export class CatalogUnavailableError extends Error {}

export interface HttpProductCatalogOptions {
    baseUrl: string;
    timeoutMs: number;
}

// Reads the product from GET /products/sku/:sku of the catalog-service (ADR-0011).
export class HttpProductCatalog implements ProductCatalogPort {

    constructor(
        private readonly options: HttpProductCatalogOptions,
        private readonly fetchFn: typeof fetch = fetch,
    ) {}

    async findBySku(sku: string): Promise<CatalogProduct> {
        const response = await this.request(sku);

        if (response.status === NOT_FOUND) {
            throw new ProductNotFoundError(sku);
        }
        if (isTransient(response.status)) {
            throw new CatalogUnavailableError(`The catalog answered HTTP ${response.status}.`);
        }
        if (!response.ok) {
            throw new ProductRequestRefusedError(sku, response.status);
        }

        const product = productSchema.safeParse(await this.readJson(response));
        if (!product.success) {
            throw new CatalogUnavailableError(`The catalog answered something that is not a product: ${z.prettifyError(product.error)}`);
        }

        if (product.data.analysisStatus !== APPROVED) {
            throw new ProductNotApprovedError(sku, product.data.analysisStatus);
        }

        const { name, description, price, stock } = product.data;
        return { sku: product.data.sku, name, description, price, stock };
    }

    private async request(sku: string): Promise<Response> {
        try {
            return await this.fetchFn(`${this.options.baseUrl.replace(/\/+$/, '')}/products/sku/${encodeURIComponent(sku)}`, {
                headers: { accept: 'application/json' },
                signal: AbortSignal.timeout(this.options.timeoutMs),
            });
        } catch (err) {
            const { name, message, cause } = err as { name?: string; message?: string; cause?: { message?: string } };
            const reason = name === 'TimeoutError' ? `did not answer within ${this.options.timeoutMs} ms` : `is unreachable: ${cause?.message ?? message}`;
            throw new CatalogUnavailableError(`The catalog ${reason}`);
        }
    }

    private async readJson(response: Response): Promise<unknown> {
        try {
            return await response.json();
        } catch {
            throw new CatalogUnavailableError('The catalog answered a body that is not JSON.');
        }
    }

}

function isTransient(status: number): boolean {
    return status >= SERVER_ERROR || status === REQUEST_TIMEOUT || status === TOO_MANY_REQUESTS;
}
