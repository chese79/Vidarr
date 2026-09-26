import { execFile } from 'node:child_process';
import { opendir } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import { normalizeTitle } from './normalize.js';
import type { FetchedLibraryArtist } from '../providers/library/types.js';

const execFileAsync = promisify(execFile);
const AUDIO_EXTENSIONS = new Set(['.aac', '.aiff', '.alac', '.ape', '.flac', '.m4a', '.mp3', '.ogg', '.opus', '.wav', '.wma']);
const MBID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const MAX_AUDIO_FILES = 100_000;

type Probe = (filePath: string) => Promise<Record<string, unknown>>;

function tag(tags: Record<string, unknown>, ...names: string[]): string | undefined {
  const byLowerName = new Map(Object.entries(tags).map(([name, value]) => [name.toLowerCase(), value]));
  for (const name of names) {
    const value = byLowerName.get(name.toLowerCase());
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

export function artistFromEmbeddedTags(tags: Record<string, unknown>): FetchedLibraryArtist | null {
  // Album artist is intentionally preferred so compilations and featured
  // performers do not explode one album into many canonical artists.
  const name = tag(tags, 'album_artist', 'albumartist', 'artist');
  if (!name || normalizeTitle(name) === 'various artists') return null;
  const rawMbid = tag(tags, 'musicbrainz_albumartistid', 'musicbrainz album artist id', 'musicbrainz_artistid', 'musicbrainz artist id');
  const musicbrainzArtistId = rawMbid?.match(MBID_PATTERN)?.[0].toLowerCase();
  return {
    externalId: `embedded:${musicbrainzArtistId ?? normalizeTitle(name)}`,
    name,
    genre: tag(tags, 'genre'),
    musicbrainzArtistId,
    musicbrainzSource: musicbrainzArtistId ? 'embedded' : undefined,
  };
}

async function listAudioFiles(rootPath: string): Promise<string[]> {
  const root = path.resolve(rootPath);
  const files: string[] = [];
  const pending = [root];
  while (pending.length) {
    const current = pending.pop()!;
    const directory = await opendir(current);
    for await (const entry of directory) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(fullPath);
      else if (entry.isFile() && AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(fullPath);
        if (files.length > MAX_AUDIO_FILES) throw new Error(`Embedded tag scan exceeds ${MAX_AUDIO_FILES} audio files`);
      }
    }
  }
  return files;
}

const ffprobe: Probe = async (filePath) => {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error', '-show_entries', 'format_tags', '-of', 'json', filePath,
  ], { timeout: 15_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
  return (JSON.parse(stdout).format?.tags ?? {}) as Record<string, unknown>;
};

export async function scanEmbeddedMusicArtists(rootPath: string, probe: Probe = ffprobe): Promise<FetchedLibraryArtist[]> {
  const files = await listAudioFiles(rootPath);
  const byIdentity = new Map<string, FetchedLibraryArtist>();
  // Bounded concurrency keeps ffprobe useful on large libraries without
  // opening thousands of processes or saturating a NAS.
  const concurrency = 4;
  for (let offset = 0; offset < files.length; offset += concurrency) {
    await Promise.all(files.slice(offset, offset + concurrency).map(async (filePath) => {
      try {
        const artist = artistFromEmbeddedTags(await probe(filePath));
        if (!artist) return;
        const key = artist.musicbrainzArtistId ?? normalizeTitle(artist.name);
        const existing = byIdentity.get(key);
        byIdentity.set(key, { ...existing, ...artist, genre: existing?.genre ?? artist.genre });
      } catch {
        // A corrupt or unsupported file does not invalidate every other tag
        // observation in the configured library.
      }
    }));
  }
  return [...byIdentity.values()];
}
