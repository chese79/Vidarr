import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const SALT_BYTES = 16;
const KEY_LENGTH = 64;
const scryptAsync = promisify(scrypt);

// node:crypto's scrypt rather than an npm bcrypt/argon2 package — this repo
// already hit real pain this session from native-binding mismatches between
// Docker build/runtime stages (see the Prisma engine binaryTargets fix); a
// built-in, pure-JS-callable primitive sidesteps that class of problem
// entirely for a single-admin-account login.
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES).toString('hex');
  const derivedKey = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  return `${salt}:${derivedKey.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, expectedHex] = stored.split(':');
  if (!salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, 'hex');
  if (expected.length !== KEY_LENGTH) return false;
  const actual = (await scryptAsync(password, salt, expected.length)) as Buffer;
  // Lengths always match here (both derived with the same KEY_LENGTH), but
  // timingSafeEqual throws on a length mismatch rather than returning false —
  // guard it explicitly so a corrupt/foreign stored value 401s instead of 500s.
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
