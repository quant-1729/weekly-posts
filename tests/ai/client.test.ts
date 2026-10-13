import { describe, expect, it } from 'vitest';
import { aiMode, estimateUsd, isTransient } from '@/lib/ai/client';

describe('ai client', () => {
  it('is always in fixture mode under vitest', () => {
    expect(aiMode()).toBe('fixture');
  });
  it('treats rate limits and overload as transient, other errors as final', () => {
    expect(isTransient(new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}'))).toBe(true);
    expect(isTransient(new Error('503 Service Unavailable'))).toBe(true);
    expect(isTransient(new Error('{"error":{"code":403,"status":"PERMISSION_DENIED"}}'))).toBe(false);
    expect(isTransient(new Error('400 invalid argument'))).toBe(false);
  });
  it('estimates cost with a high fallback for unknown models', () => {
    expect(estimateUsd('gemini-3.8-flash', 1_000_000, 0)).toBeCloseTo(0.5);
    expect(estimateUsd('unknown-model', 1_000_000, 0)).toBeCloseTo(1.0);
  });
});

describe('timeouts', () => {
  it('treats aborted and timed-out calls as transient', () => {
    const e = new Error('The operation was aborted due to timeout');
    e.name = 'TimeoutError';
    expect(isTransient(e)).toBe(true);
    const a = new Error('This operation was aborted');
    a.name = 'AbortError';
    expect(isTransient(a)).toBe(true);
  });
});
