import { randomBytes } from 'node:crypto';
import { prisma } from '../db/client.js';
import { hashPassword } from './password.js';

// Local console recovery has the same authority as editing this installation's
// configuration. Never expose this operation as an unauthenticated HTTP route.
export async function recoverOwnerLogin() {
  const owner = await prisma.settings.findUnique({ where: { id: 1 }, select: { adminUsername: true } });
  if (!owner?.adminUsername) throw new Error('No owner account is configured. Use the existing first-run or API-key sign-in flow.');
  const password = randomBytes(18).toString('base64url');
  const result = await prisma.settings.updateMany({ where: { id: 1, adminUsername: owner.adminUsername }, data: { adminPasswordHash: await hashPassword(password) } });
  if (result.count !== 1) throw new Error('Owner account changed during recovery. Retry after checking the current configuration.');
  return { username: owner.adminUsername, password };
}
