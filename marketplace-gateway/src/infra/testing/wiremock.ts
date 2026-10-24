import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const SCRIPTS_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'scripts');

// The prefixes under which docker/wiremock/mappings serves each marketplace.
export const SIMULATOR_PATHS = {
    AMAZON: '/amazon',
    MERCADO_LIVRE: '/mercadolivre',
    SHOPEE: '/shopee',
} as const;

export type SimulatedMarketplace = keyof typeof SIMULATOR_PATHS;

export interface RecordedRequest {
    method: string;
    url: string;
    path: string;
    queryParams: Record<string, string>;
    body: string;
    headers: Record<string, string>;
}

export function wiremockUrl(): string {
    const url = process.env.TEST_WIREMOCK_URL;
    if (!url) {
        throw new Error('TEST_WIREMOCK_URL is not set: specs that need WireMock are named *.int.spec.ts and run in the "integration" Jest project.');
    }
    return url;
}

export function simulatorBaseUrl(marketplace: SimulatedMarketplace): string {
    return `${wiremockUrl()}${SIMULATOR_PATHS[marketplace]}`;
}

async function admin(method: string, adminPath: string, body?: unknown): Promise<unknown> {
    const response = await fetch(`${wiremockUrl()}/__admin${adminPath}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();

    if (!response.ok) {
        throw new Error(`WireMock ${method} ${adminPath} answered ${response.status}: ${text}`);
    }
    return text === '' ? undefined : JSON.parse(text);
}

// Back to the mappings of the files: no dynamic stub, every scenario in its normal state, an empty journal.
export async function resetWiremock(): Promise<void> {
    await admin('POST', '/reset');
}

export async function addStub(stub: unknown): Promise<void> {
    await admin('POST', '/mappings', stub);
}

export async function requestsTo(urlPath: string): Promise<RecordedRequest[]> {
    const journal = await admin('GET', '/requests') as { requests: { request: RecordedRequest & { queryParams?: Record<string, { values: string[] }> } }[] };

    return journal.requests
        .map(({ request }) => ({
            ...request,
            path: new URL(request.url, 'http://wiremock').pathname,
            queryParams: Object.fromEntries(Object.entries(request.queryParams ?? {}).map(([name, value]) => [name, value.values[0]])),
        }))
        .filter(request => request.path === urlPath)
        .reverse();
}

// The scripts of the demo (scripts/simulate-order.sh and scripts/simulate-failure.sh), run as they are.
async function script(name: string, args: string[]): Promise<string> {
    const { stdout } = await run(path.join(SCRIPTS_DIR, name), args, { env: { ...process.env, WIREMOCK_URL: wiremockUrl() } });
    return stdout;
}

export function simulateOrder(marketplace: SimulatedMarketplace | 'all', options: { sku?: string; qty?: number; price?: string; id?: string } = {}): Promise<string> {
    const scriptName = marketplace === 'all' ? 'all' : { AMAZON: 'amazon', MERCADO_LIVRE: 'mercadolivre', SHOPEE: 'shopee' }[marketplace];
    const args = [scriptName];

    if (options.sku) args.push('--sku', options.sku);
    if (options.qty) args.push('--qty', String(options.qty));
    if (options.price) args.push('--price', options.price);
    if (options.id) args.push('--id', options.id);

    return script('simulate-order.sh', args);
}

export type FailureMode = 'unavailable' | 'throttled' | 'slow' | 'flaky' | 'off';

export function simulateFailure(marketplace: SimulatedMarketplace | 'all', mode: FailureMode): Promise<string> {
    const scriptName = marketplace === 'all' ? 'all' : { AMAZON: 'amazon', MERCADO_LIVRE: 'mercadolivre', SHOPEE: 'shopee' }[marketplace];

    return script('simulate-failure.sh', [scriptName, mode]);
}
