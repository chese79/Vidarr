const secrets = new Set<string>();
const sensitiveKey = /(?:apiKey|secret|password|token|sessionKey)(?:Hash)?$/i;

export function rememberSecrets(value: unknown): void {
  if (Array.isArray(value)) { value.forEach(rememberSecrets); return; }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (sensitiveKey.test(key) && typeof item === 'string' && item.length >= 4) secrets.add(item);
    else if (item && typeof item === 'object') rememberSecrets(item);
  }
}

export function redactMessage(value: unknown): string {
  let text = value instanceof Error ? value.message : String(value ?? '');
  for (const secret of secrets) {
    for (const variant of new Set([secret, encodeURIComponent(secret)])) text = text.split(variant).join('[REDACTED]');
  }
  return text
    .replace(/([?&](?:api[-_]?key|key|token|x-plex-token|authToken|access_token|refresh_token|password|secret|session_key|auth|code|signature)=)[^\s&#"']*/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/((?:cookie|authorization|password|api_?key|sharedSecret|clientSecret|sessionKey)\s*[=:]\s*)[^\r\n]+/gi, '$1[REDACTED]');
}

// Preserve structured history while removing credential-bearing values.
export function redactDiagnostic(value: string): string {
  try {
    const scrub = (item: unknown): unknown => {
      if (Array.isArray(item)) return item.map(scrub);
      if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, val]) =>
        [key, sensitiveKey.test(key) ? '[REDACTED]' : scrub(val)]));
      return typeof item === 'string' ? redactMessage(item) : item;
    };
    return JSON.stringify(scrub(JSON.parse(value)));
  } catch { return redactMessage(value); }
}
