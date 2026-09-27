import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../db/client.js';
import { artistNameHint, isUsableArtistHint } from './artistObservation.js';
import { normalizeTitle } from './normalize.js';

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.mov', '.m4v', '.avi', '.webm']);
const MAX_FILES = 20_000;

export async function accessibleRootPath(configuredPath: string): Promise<string> {
  try { await fs.access(configuredPath); return configuredPath; } catch { /* Docker path mapping below */ }
  const windows = /^([a-z]):[\\/](.*)$/i.exec(configuredPath);
  if (process.platform !== 'win32' && windows) {
    const mapped = path.join('/mnt', windows[1].toLowerCase(), ...windows[2].split(/[\\/]+/));
    await fs.access(mapped);
    return mapped;
  }
  throw new Error(`Root folder is not accessible: ${configuredPath}`);
}

export function localVideoName(filePath: string, rootPath: string): { artistName: string; title: string } {
  const stem = path.parse(filePath).name.replace(/\s*\[[^\]]+\]\s*$/, '').replace(/\s*\(\d{4}\)\s*$/, '').trim();
  const split = /^(.{1,80}?)\s+[-–—]\s+(.+)$/.exec(stem);
  const parent = path.dirname(filePath);
  const folderArtist = parent !== rootPath ? path.basename(parent) : '';
  const artistName = artistNameHint(split?.[1] || folderArtist);
  return { artistName, title: split?.[2]?.trim() || stem };
}

export async function scanLocalVideoCandidates(): Promise<{ scanned: number; pending: number; roots: number }> {
  const roots = await prisma.rootFolder.findMany({ orderBy: { id: 'asc' } });
  const confirmedArtists = await prisma.artist.findMany({
    where: { musicbrainzMatchStatus: 'confirmed', musicbrainzArtistId: { not: null } },
    select: { id: true, name: true },
  });
  const artistByName = new Map(confirmedArtists.map((artist) => [normalizeTitle(artist.name), artist.id]));
  let scanned = 0;
  let pending = 0;
  for (const root of roots) {
    const rootPath = await accessibleRootPath(root.path);
    const queue = [rootPath];
    while (queue.length) {
      const directory = queue.pop()!;
      const entries = await fs.readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        const filePath = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) { queue.push(filePath); continue; }
        if (!entry.isFile() || !VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
        if (++scanned > MAX_FILES) throw new Error(`Local scan exceeded ${MAX_FILES} video files; narrow the root folder.`);
        const { artistName, title } = localVideoName(filePath, rootPath);
        if (!isUsableArtistHint(artistName) || !normalizeTitle(title)) continue;
        const artistId = artistByName.get(normalizeTitle(artistName)) ?? null;
        const candidate = await prisma.videoReviewCandidate.upsert({
          where: { source_externalId: { source: 'local', externalId: filePath } },
          update: { artistName, title, artistId },
          create: {
            source: 'local', externalId: filePath, filePath, artistName, title,
            artistId,
            reason: 'Existing file needs song music-video and artist confirmation.',
          },
        });
        if (candidate.decision === 'pending') pending++;
      }
    }
  }
  return { scanned, pending, roots: roots.length };
}
