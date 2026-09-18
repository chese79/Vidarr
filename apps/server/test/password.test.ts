import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../src/pipeline/password.js';

describe('password hashing (pipeline/password.ts)', () => {
  it('never stores the plaintext password in the hash', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).not.toContain('correct horse battery staple');
  });

  it('verifies the correct password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    await expect(verifyPassword('correct horse battery staple', hash)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    await expect(verifyPassword('wrong password', hash)).resolves.toBe(false);
  });

  it('produces a different hash each time for the same password (random salt)', async () => {
    const first = await hashPassword('same password');
    const second = await hashPassword('same password');
    expect(first).not.toBe(second);
    // ...but both still verify correctly against their own hash.
    await expect(verifyPassword('same password', first)).resolves.toBe(true);
    await expect(verifyPassword('same password', second)).resolves.toBe(true);
  });

  it('rejects against a malformed/foreign stored value instead of throwing', async () => {
    await expect(verifyPassword('anything', 'not-a-valid-hash')).resolves.toBe(false);
    await expect(verifyPassword('anything', '')).resolves.toBe(false);
  });

  it('is case-sensitive', async () => {
    const hash = await hashPassword('Password123');
    await expect(verifyPassword('password123', hash)).resolves.toBe(false);
  });
});
