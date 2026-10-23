// Old databases retain historical counters for backup/rollback compatibility.
// They are no longer part of any public response or play-count policy.
const retiredFields = new Set(['qualifiedPlayCount', 'lastQualifiedPlayAt', 'qualifiedAt']);
export function withoutRetiredPlayCounters(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutRetiredPlayCounters);
  if (!value || typeof value !== 'object' || value instanceof Date || Buffer.isBuffer(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !retiredFields.has(key))
    .map(([key, nested]) => [key, withoutRetiredPlayCounters(nested)]));
}
