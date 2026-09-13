import { describe, it, expect, vi } from 'vitest';
import { withRetry } from '../src/pipeline/retry.js';

describe('withRetry', () => {
  it('returns the result on first success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, 3, 1);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries after a failure and succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce('recovered');
    const result = await withRetry(fn, 3, 1);
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws the last error after exhausting all attempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));
    await expect(withRetry(fn, 3, 1)).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not swallow a genuinely-down service — surfaces the real error, not a generic one', async () => {
    const specificError = new Error('ECONNREFUSED');
    const fn = vi.fn().mockRejectedValue(specificError);
    await expect(withRetry(fn, 2, 1)).rejects.toBe(specificError);
  });

  it('defaults to 3 attempts when not specified', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    await expect(withRetry(fn)).rejects.toThrow('fail');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
