// Small shared retry helper for flaky network calls to self-hosted services
// (download clients, indexers) — a couple of quick retries with backoff
// covers the common "service was mid-restart" / transient-timeout case
// without masking a genuinely-down service (it still throws after exhausting
// attempts).
export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  baseDelayMs = 500,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === attempts) break;
      await new Promise((r) => setTimeout(r, baseDelayMs * attempt));
    }
  }
  throw lastError;
}
