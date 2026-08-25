import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../db/client.js';

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface LibraryMetadata {
  artistName: string;
  title: string;
  year: number | null;
  director: string | null;
  thumbnailUrl: string | null;
}

// Writes a Kodi-style <musicvideo> NFO sidecar next to the video file — the
// convention Jellyfin's (and Kodi's) local-metadata reader uses for music
// videos, so the artist/title/year/director vidarr already knows are read
// exactly as-is rather than re-guessed from the filename. This also makes
// playlist-push matching (providers/library/*.ts) reliable independent of
// whatever quality tag ends up in the filename itself.
//
// Plex's own Personal Media agent does not read this NFO format — the local
// thumbnail written alongside is what it (and Jellyfin/Kodi) picks up for
// artwork instead.
export async function writeLibraryMetadata(videoPath: string, meta: LibraryMetadata): Promise<void> {
  const base = videoPath.slice(0, -path.extname(videoPath).length);
  const nfo = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<musicvideo>',
    `  <title>${xmlEscape(meta.title)}</title>`,
    `  <artist>${xmlEscape(meta.artistName)}</artist>`,
    meta.year ? `  <year>${meta.year}</year>` : null,
    meta.director ? `  <director>${xmlEscape(meta.director)}</director>` : null,
    '</musicvideo>',
    '',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
  await fs.writeFile(`${base}.nfo`, nfo, 'utf-8');

  if (meta.thumbnailUrl) {
    try {
      const res = await fetch(meta.thumbnailUrl);
      if (res.ok) {
        const buffer = Buffer.from(await res.arrayBuffer());
        await fs.writeFile(`${base}-thumb.jpg`, buffer);
      }
    } catch {
      // best-effort — a missing/broken thumbnail shouldn't fail the import
    }
  }
}

// Manual, on-demand backfill (matches the rest of this codebase's "button, not
// a recurring job" pattern for one-off maintenance actions) — writes NFO +
// thumbnail sidecars for every already-imported file, so files imported
// before this convention existed pick it up without re-downloading.
export async function regenerateAllLibraryMetadata(): Promise<{ written: number; failed: number }> {
  const files = await prisma.musicVideoFile.findMany({
    include: { musicVideo: { include: { artist: true } } },
  });

  let written = 0;
  let failed = 0;
  for (const file of files) {
    try {
      await writeLibraryMetadata(file.path, {
        artistName: file.musicVideo.artist.name,
        title: file.musicVideo.title,
        year: file.musicVideo.releaseYear,
        director: file.musicVideo.director,
        thumbnailUrl: file.musicVideo.thumbnailUrl,
      });
      written++;
    } catch (err) {
      failed++;
      await prisma.activityLog.create({
        data: {
          level: 'warn',
          source: 'library-convention-backfill',
          message: `${file.path}: ${(err as Error).message}`,
        },
      });
    }
  }

  return { written, failed };
}
