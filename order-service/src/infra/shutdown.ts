import { Logger } from 'pino';

export interface ShutdownProps {
    // Run one after the other, in this order.
    steps: Array<() => Promise<void>>;
    timeoutMs: number;
    exit: (code: number) => void;
    logger: Logger;
}

// Stops the service in order and exits with 0. A step that fails, or a shutdown that takes longer than
// timeoutMs (e.g. a broker that never answers), exits with 1 instead of leaving the process hanging.
export function createShutdown({ steps, timeoutMs, exit, logger }: ShutdownProps): (signal: string) => Promise<void> {
    return async signal => {
        logger.info({ signal }, 'Shutting down');
        const timer = setTimeout(() => {
            logger.error({ timeoutMs }, 'Shutdown timed out');
            exit(1);
        }, timeoutMs);

        try {
            for (const step of steps) {
                await step();
            }
            exit(0);
        } catch (err) {
            logger.error({ err }, 'Shutdown failed');
            exit(1);
        } finally {
            clearTimeout(timer);
        }
    };
}

export interface ServiceResources {
    consumers: Array<{ disconnect(): Promise<void> }>;
    server: { close(callback: () => void): unknown };
    relay: { stop(): Promise<void> };
    producer: { disconnect(): Promise<void> };
    db: { destroy(): Promise<void> };
}

// INF-02: consumers first, so no message is handled half-way, then the server, the relay round and the connections.
export function shutdownSteps({ consumers, server, relay, producer, db }: ServiceResources): ShutdownProps['steps'] {
    return [
        async () => { for (const consumer of consumers) await consumer.disconnect(); },
        () => new Promise<void>(resolve => server.close(() => resolve())),
        () => relay.stop(),
        () => producer.disconnect(),
        () => db.destroy(),
    ];
}
