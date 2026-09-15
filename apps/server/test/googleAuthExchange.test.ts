import { describe, it, expect, vi, afterEach } from 'vitest';
import { createExchangeToken, consumeExchangeToken } from '../src/pipeline/googleAuthExchange.js';

describe('google auth exchange token store', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the associated apiKey on first consume', () => {
    const token = createExchangeToken('the-key');
    expect(consumeExchangeToken(token)).toBe('the-key');
  });

  it('is single-use — a second consume of the same token returns null', () => {
    const token = createExchangeToken('the-key');
    consumeExchangeToken(token);
    expect(consumeExchangeToken(token)).toBeNull();
  });

  it('returns null for a token that was never issued', () => {
    expect(consumeExchangeToken('never-issued')).toBeNull();
  });

  it('expires on its own after 60 seconds, even if never consumed', () => {
    vi.useFakeTimers();
    const token = createExchangeToken('the-key');
    vi.advanceTimersByTime(61_000);
    expect(consumeExchangeToken(token)).toBeNull();
  });

  it('still works normally just under the expiry boundary', () => {
    vi.useFakeTimers();
    const token = createExchangeToken('the-key');
    vi.advanceTimersByTime(59_000);
    expect(consumeExchangeToken(token)).toBe('the-key');
  });
});
