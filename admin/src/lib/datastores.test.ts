import { describe, expect, it } from 'vitest';
import { withTimeout } from './datastores';

describe('withTimeout', () => {
  it('resolves fast promises', async () => {
    await expect(withTimeout(Promise.resolve(42), 50)).resolves.toBe(42);
  });
  it('rejects when the probe exceeds the budget', async () => {
    await expect(withTimeout(new Promise(() => {}), 30)).rejects.toThrow(/timed out/);
  });
});
