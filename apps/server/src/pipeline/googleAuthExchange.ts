import { randomBytes } from 'node:crypto';

const EXCHANGE_TOKEN_TTL_MS = 60 * 1000;

// Bridges the Google OAuth callback (a browser redirect, so nothing sensitive
// should ride in that URL) to the frontend handing back the real API key.
// The callback mints one of these and redirects to it; the frontend
// immediately POSTs it back once, over a request body rather than a URL, to
// get the actual key. In-memory only — single-process app, and a 60-second
// lifetime means losing this on a restart mid-flow is a non-issue (the user
// just retries "Sign in with Google").
const pendingExchanges = new Map<string, { apiKey: string; expiresAt: number }>();

export function createExchangeToken(apiKey: string): string {
  const token = randomBytes(32).toString('hex');
  pendingExchanges.set(token, { apiKey, expiresAt: Date.now() + EXCHANGE_TOKEN_TTL_MS });
  return token;
}

// Single-use: whether this call succeeds or not, the token is gone
// afterward, so a stolen/replayed exchange link only ever works once.
export function consumeExchangeToken(token: string): string | null {
  const entry = pendingExchanges.get(token);
  pendingExchanges.delete(token);
  if (!entry || entry.expiresAt < Date.now()) return null;
  return entry.apiKey;
}
