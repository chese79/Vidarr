import path from 'node:path';
import { isPathWithinRoot } from './pathContainment.js';

// Host and container mount prefixes may differ; the managed path below the
// library root must agree. An older copy elsewhere cannot confirm this import.
export function serverDeliveryPathMatches(localPath: string | null | undefined, rootPath: string, serverPath: string | null | undefined): boolean {
  if (!localPath || !serverPath || !isPathWithinRoot(rootPath, localPath)) return false;
  const relative = path.relative(rootPath, localPath).replace(/\\/g, '/').toLowerCase();
  return serverPath.replace(/\\/g, '/').toLowerCase().endsWith(`/${relative}`);
}
