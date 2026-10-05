import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dispatchTick = vi.fn();
vi.mock('../src/repos/bookings.repo.js', () => ({
  dispatchTick: (...args) => dispatchTick(...args),
  getOfferForPartner: vi.fn(),
}));

const logs = { error: [], info: [], warn: [] };
vi.mock('../src/utils/logger.js', () => ({
  logger: {
    error: (msg, meta) => logs.error.push({ msg, meta }),
    info: (msg, meta) => logs.info.push({ msg, meta }),
    warn: (msg, meta) => logs.warn.push({ msg, meta }),
  },
}));

const { runTick, kick, __resetDispatcherBackoff } = await import('../src/services/dispatcher.js');
const { RULES } = await import('../src/config/constants.js');

const errorsFor = (error) => logs.error.filter((l) => l.meta?.error === error);

beforeEach(() => {
  vi.useFakeTimers();
  dispatchTick.mockReset();
  logs.error.length = 0;
  logs.info.length = 0;
  logs.warn.length = 0;
  __resetDispatcherBackoff();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Dispatcher failure handling', () => {
  it('logs the first failure with the retry delay', async () => {
    dispatchTick.mockRejectedValue(new Error('fetch failed'));
    await runTick();
    expect(logs.error).toHaveLength(1);
    expect(logs.error[0].msg).toBe('Dispatcher tick failed');
    expect(logs.error[0].meta.consecutiveFailures).toBe(1);
    expect(logs.error[0].meta.retryInMs).toBe(RULES.dispatchIntervalMs);
  });

  it('does not re-log an identical error on every tick', async () => {
    dispatchTick.mockRejectedValue(new Error('fetch failed'));
    for (let i = 0; i < 20; i += 1) await runTick();
    expect(errorsFor('fetch failed')).toHaveLength(1);
  });

  it('logs a different error straight away', async () => {
    dispatchTick.mockRejectedValueOnce(new Error('fetch failed'));
    await runTick();
    dispatchTick.mockRejectedValueOnce(new Error('permission denied'));
    await runTick();
    expect(errorsFor('permission denied')).toHaveLength(1);
  });

  it('repeats a stuck error at most every five minutes, with the suppressed count', async () => {
    dispatchTick.mockRejectedValue(new Error('fetch failed'));
    await runTick();
    await runTick();
    await runTick();
    expect(errorsFor('fetch failed')).toHaveLength(1);

    vi.advanceTimersByTime(5 * 60 * 1000);
    await runTick();
    const repeat = errorsFor('fetch failed')[1];
    expect(repeat.meta.repeatsSinceLastLog).toBe(2);
    expect(repeat.meta.consecutiveFailures).toBe(4);
  });

  it('caps the backoff at a minute', async () => {
    dispatchTick.mockRejectedValue(new Error('fetch failed'));
    for (let i = 0; i < 12; i += 1) await runTick();
    dispatchTick.mockRejectedValueOnce(new Error('other'));
    await runTick();
    expect(errorsFor('other')[0].meta.retryInMs).toBe(60_000);
  });

  it('skips scheduled ticks while the backoff is open, then resumes', async () => {
    dispatchTick.mockRejectedValue(new Error('fetch failed'));
    await runTick();
    const afterFirst = dispatchTick.mock.calls.length;

    kick();
    await vi.advanceTimersByTimeAsync(0);
    expect(dispatchTick.mock.calls.length).toBe(afterFirst);

    vi.advanceTimersByTime(RULES.dispatchIntervalMs);
    kick();
    await vi.advanceTimersByTimeAsync(0);
    expect(dispatchTick.mock.calls.length).toBe(afterFirst + 1);
  });

  it('never skips a direct runTick call', async () => {
    dispatchTick.mockRejectedValue(new Error('fetch failed'));
    await runTick();
    await runTick();
    expect(dispatchTick.mock.calls.length).toBe(2);
  });

  it('reports recovery and clears the backoff', async () => {
    dispatchTick.mockRejectedValue(new Error('fetch failed'));
    await runTick();
    await runTick();

    dispatchTick.mockResolvedValue([]);
    await runTick();
    expect(logs.info.at(-1)).toMatchObject({
      msg: 'Dispatcher recovered',
      meta: { afterFailures: 2, lastError: 'fetch failed' },
    });

    kick();
    await vi.advanceTimersByTimeAsync(0);
    expect(dispatchTick.mock.calls.length).toBe(4);
  });

  it('stays quiet while ticks succeed', async () => {
    dispatchTick.mockResolvedValue([]);
    await runTick();
    await runTick();
    expect(logs.error).toHaveLength(0);
    expect(logs.info).toHaveLength(0);
  });
});
