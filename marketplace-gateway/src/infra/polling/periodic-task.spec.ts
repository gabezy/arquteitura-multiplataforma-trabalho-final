import { PeriodicTask } from './periodic-task';

const INTERVAL_MS = 1000;

describe('PeriodicTask', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('runs a round at once and then one every interval', async () => {
    const task = jest.fn().mockResolvedValue(undefined);
    const periodic = new PeriodicTask(task);

    periodic.start({ intervalMs: INTERVAL_MS, onError: jest.fn() });
    await jest.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(INTERVAL_MS - 1);
    expect(task).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(2);

    await jest.advanceTimersByTimeAsync(2 * INTERVAL_MS);
    expect(task).toHaveBeenCalledTimes(4);

    await periodic.stop();
  });

  it('starts the next round only after the round in progress ends and the interval has passed', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const starts: number[] = [];
    const task = jest.fn(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      starts.push(Date.now());
      await new Promise(resolve => setTimeout(resolve, 3 * INTERVAL_MS));
      inFlight--;
    });
    const periodic = new PeriodicTask(task);
    const origin = Date.now();

    periodic.start({ intervalMs: INTERVAL_MS, onError: jest.fn() });
    await jest.advanceTimersByTimeAsync(10 * INTERVAL_MS);
    const stopping = periodic.stop();
    await jest.advanceTimersByTimeAsync(3 * INTERVAL_MS);
    await stopping;

    expect(maxInFlight).toBe(1);
    expect(starts.map(start => start - origin)).toEqual([0, 4 * INTERVAL_MS, 8 * INTERVAL_MS]);
  });

  it('reports a round that fails and keeps going', async () => {
    const onError = jest.fn();
    const task = jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined);
    const periodic = new PeriodicTask(task);

    periodic.start({ intervalMs: INTERVAL_MS, onError });
    await jest.advanceTimersByTimeAsync(INTERVAL_MS);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(new Error('boom'));
    expect(task).toHaveBeenCalledTimes(2);
    await periodic.stop();
  });

  it('lets the round in progress finish when stopped', async () => {
    let finishRound: () => void = () => undefined;
    const task = jest.fn(() => new Promise<void>(resolve => (finishRound = resolve)));
    const periodic = new PeriodicTask(task);
    periodic.start({ intervalMs: INTERVAL_MS, onError: jest.fn() });
    await jest.advanceTimersByTimeAsync(0);

    let stopped = false;
    const stopping = periodic.stop().then(() => (stopped = true));
    await jest.advanceTimersByTimeAsync(5 * INTERVAL_MS);
    expect(stopped).toBe(false);

    finishRound();
    await stopping;

    expect(stopped).toBe(true);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('runs no round after it is stopped', async () => {
    const task = jest.fn().mockResolvedValue(undefined);
    const periodic = new PeriodicTask(task);
    periodic.start({ intervalMs: INTERVAL_MS, onError: jest.fn() });
    await jest.advanceTimersByTimeAsync(0);

    await periodic.stop();
    await jest.advanceTimersByTimeAsync(10 * INTERVAL_MS);

    expect(task).toHaveBeenCalledTimes(1);
  });

  it('does not run two loops when started twice', async () => {
    const task = jest.fn().mockResolvedValue(undefined);
    const periodic = new PeriodicTask(task);

    periodic.start({ intervalMs: INTERVAL_MS, onError: jest.fn() });
    periodic.start({ intervalMs: INTERVAL_MS, onError: jest.fn() });
    await jest.advanceTimersByTimeAsync(0);

    expect(task).toHaveBeenCalledTimes(1);
    await periodic.stop();
  });
});
