import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../src/pipeline/password.js';

describe('password hashing (pipeline/password.ts)', () => {
  it('never stores the plaintext password in the hash', () => {
    const hash = hashPassword('correct horse battery staple');
    expect(hash).not.toContain('correct horse battery staple');
  });

  it('verifies the correct password', () => {
    const hash = hashPassword('correct horse battery staple');
    expect(verifyPassword('correct horse battery staple', hash)).toBe(true);
  });

  it('rejects a wrong password', () => {
    const hash = hashPassword('correct horse battery staple');
    expect(verifyPassword('wrong password', hash)).toBe(false);
  });

  it('produces a different hash each time for the same password (random salt)', () => {
    const first = hashPassword('same password');
    const second = hashPassword('same password');
    expect(first).not.toBe(second);
    // ...but both still verify correctly against their own hash.
    expect(verifyPassword('same password', first)).toBe(true);
    expect(verifyPassword('same password', second)).toBe(true);
  });

  it('rejects against a malformed/foreign stored value instead of throwing', () => {
    expect(verifyPassword('anything', 'not-a-valid-hash')).toBe(false);
    expect(verifyPassword('anything', '')).toBe(false);
  });

  it('is case-sensitive', () => {
    const hash = hashPassword('Password123');
    expect(verifyPassword('password123', hash)).toBe(false);
  });
});
