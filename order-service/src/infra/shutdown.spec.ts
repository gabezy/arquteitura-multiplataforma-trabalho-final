import pino from 'pino';
import { createShutdown, shutdownSteps } from './shutdown';

describe('createShutdown', () => {
    const logger = pino({ level: 'silent' });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('runs every step in order and then exits with 0', async () => {
        const calls: string[] = [];
        const exit = jest.fn((code: number) => { calls.push(`exit ${code}`); });
        const step = (name: string) => async () => { calls.push(name); };

        await createShutdown({ steps: [step('consumers'), step('server'), step('relay')], timeoutMs: 10_000, exit, logger })('SIGTERM');

        expect(calls).toEqual(['consumers', 'server', 'relay', 'exit 0']);
    });

    it('exits with 1 when a step fails, without running the next ones', async () => {
        const exit = jest.fn();
        const next = jest.fn();

        await createShutdown({ steps: [async () => { throw new Error('broker gone'); }, next], timeoutMs: 10_000, exit, logger })('SIGTERM');

        expect(exit).toHaveBeenCalledTimes(1);
        expect(exit).toHaveBeenCalledWith(1);
        expect(next).not.toHaveBeenCalled();
    });

    it('exits with 1 once the timeout passes while a step hangs', async () => {
        jest.useFakeTimers();
        const exit = jest.fn();

        void createShutdown({ steps: [() => new Promise<void>(() => undefined)], timeoutMs: 10_000, exit, logger })('SIGTERM');

        await jest.advanceTimersByTimeAsync(9_999);
        expect(exit).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(1);
        expect(exit).toHaveBeenCalledWith(1);
    });

    it('stops the consumers first, then the server, the relay, the producer and the database', async () => {
        const calls: string[] = [];
        const record = (name: string) => async () => { calls.push(name); };
        const steps = shutdownSteps({
            consumers: [{ disconnect: record('marketplace consumer') }, { disconnect: record('stock consumer') }],
            server: { close: (callback: () => void) => { calls.push('server'); callback(); } },
            relay: { stop: record('relay') },
            producer: { disconnect: record('producer') },
            db: { destroy: record('db') },
        });

        for (const step of steps) await step();

        expect(calls).toEqual(['marketplace consumer', 'stock consumer', 'server', 'relay', 'producer', 'db']);
    });
});
