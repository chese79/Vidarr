export const TEST_API_KEY = 'test-api-key';

export function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { 'x-api-key': TEST_API_KEY, ...extra };
}
