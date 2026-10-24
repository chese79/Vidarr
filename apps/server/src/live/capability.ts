import { prisma } from '../db/client.js';
import { LiveError } from './policy.js';

// Installer/component option; independent of browser catalog preference and validation edition.
export function liveAvailable() { return process.env.VIDARR_LIVE_COMPONENT !== 'disabled'; }
export async function liveEnabled() {
  return liveAvailable() && (await prisma.settings.findUnique({ where: { id: 1 }, select: { liveEnabled: true } }))?.liveEnabled !== false;
}
export async function requireLiveEnabled() {
  if (!await liveEnabled()) throw new LiveError('Live & Concerts is unavailable or disabled in General settings');
}
