export interface PeriodicTaskOptions {
    intervalMs: number;
    onError: (err: unknown) => void;
}

// Runs a task over and over. Each round starts only after the previous one ends and the interval
// has passed, so rounds never overlap, and a failed round is reported and followed by the next one.
export class PeriodicTask {

    private running = false;
    private loop?: Promise<void>;
    private wakeUp?: () => void;

    constructor(private readonly task: () => Promise<void>) {}

    start(options: PeriodicTaskOptions): void {
        if (this.running) {
            return;
        }
        this.running = true;
        this.loop = this.runLoop(options);
    }

    // Lets the round in progress finish.
    async stop(): Promise<void> {
        this.running = false;
        this.wakeUp?.();
        await this.loop;
    }

    private async runLoop({ intervalMs, onError }: PeriodicTaskOptions): Promise<void> {
        while (this.running) {
            await this.task().catch(onError);
            await this.pause(intervalMs);
        }
    }

    private pause(ms: number): Promise<void> {
        if (!this.running) {
            return Promise.resolve();
        }
        return new Promise(resolve => {
            const timer = setTimeout(resolve, ms);
            this.wakeUp = () => {
                clearTimeout(timer);
                resolve();
            };
        });
    }

}
