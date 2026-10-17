// SQLite has one writer. One application connection keeps concurrent discovery,
// queue and API writes from competing inside Prisma's default connection pool.
export function sqliteRuntimeUrl(url: string): string {
  const index = url.indexOf('?');
  const path = index < 0 ? url : url.slice(0, index);
  const params = new URLSearchParams(index < 0 ? '' : url.slice(index + 1));
  params.set('connection_limit', '1');
  if (!params.has('socket_timeout')) params.set('socket_timeout', '15');
  if (!params.has('pool_timeout')) params.set('pool_timeout', '30');
  return `${path}?${params}`;
}
