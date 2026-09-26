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

export interface EmbeddedRecordingObservation {
  filePath: string;
  title: string;
  album?: string;
  artistName: string;
  albumArtistName?: string;
  genre?: string;
  trackNumber?: number;
  discNumber?: number;
  musicbrainzArtistId?: string;
  musicbrainzAlbumArtistId?: string;
  musicbrainzRecordingId?: string;
  musicbrainzReleaseId?: string;
  musicbrainzReleaseGroupId?: string;
}

export interface EmbeddedMusicScanResult {
  artists: FetchedLibraryArtist[];
  recordings: EmbeddedRecordingObservation[];
}

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

function mbid(tags: Record<string, unknown>, ...names: string[]) {
  return tag(tags, ...names)?.match(MBID_PATTERN)?.[0].toLowerCase();
}

function positiveInteger(value?: string): number | undefined {
  const parsed = Number.parseInt(value?.split('/')[0] ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function recordingFromEmbeddedTags(filePath: string, tags: Record<string, unknown>): EmbeddedRecordingObservation | null {
  const artistName = tag(tags, 'artist', 'album_artist', 'albumartist');
  if (!artistName) return null;
  return {
    filePath,
    title: tag(tags, 'title') ?? path.basename(filePath, path.extname(filePath)),
    album: tag(tags, 'album'),
    artistName,
    albumArtistName: tag(tags, 'album_artist', 'albumartist'),
    genre: tag(tags, 'genre'),
    trackNumber: positiveInteger(tag(tags, 'track', 'tracknumber')),
    discNumber: positiveInteger(tag(tags, 'disc', 'discnumber')),
    musicbrainzArtistId: mbid(tags, 'musicbrainz_artistid', 'musicbrainz artist id'),
    musicbrainzAlbumArtistId: mbid(tags, 'musicbrainz_albumartistid', 'musicbrainz album artist id'),
    musicbrainzRecordingId: mbid(tags, 'musicbrainz_recordingid', 'musicbrainz recording id'),
    musicbrainzReleaseId: mbid(tags, 'musicbrainz_albumid', 'musicbrainz release id'),
    musicbrainzReleaseGroupId: mbid(tags, 'musicbrainz_releasegroupid', 'musicbrainz release group id'),
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
  return files.sort((left, right) => left.localeCompare(right));
}

const ffprobe: Probe = async (filePath) => {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error', '-show_entries', 'format_tags', '-of', 'json', filePath,
  ], { timeout: 15_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
  return (JSON.parse(stdout).format?.tags ?? {}) as Record<string, unknown>;
};

export async function scanEmbeddedMusicLibrary(rootPath: string, probe: Probe = ffprobe): Promise<EmbeddedMusicScanResult> {
  const files = await listAudioFiles(rootPath);
  const byIdentity = new Map<string, FetchedLibraryArtist>();
  const recordings: EmbeddedRecordingObservation[] = [];
  // Bounded concurrency keeps ffprobe useful on large libraries without
  // opening thousands of processes or saturating a NAS.
  const concurrency = 4;
  for (let offset = 0; offset < files.length; offset += concurrency) {
    await Promise.all(files.slice(offset, offset + concurrency).map(async (filePath) => {
      try {
        const tags = await probe(filePath);
        const recording = recordingFromEmbeddedTags(filePath, tags);
        if (recording) recordings.push(recording);
        const artist = artistFromEmbeddedTags(tags);
        if (artist) {
          const key = artist.musicbrainzArtistId ?? normalizeTitle(artist.name);
          const existing = byIdentity.get(key);
          byIdentity.set(key, { ...existing, ...artist, genre: existing?.genre ?? artist.genre });
        }
      } catch {
        // A corrupt or unsupported file does not invalidate every other tag
        // observation in the configured library.
      }
    }));
  }
  return { artists: [...byIdentity.values()], recordings };
}

export async function scanEmbeddedMusicArtists(rootPath: string, probe: Probe = ffprobe): Promise<FetchedLibraryArtist[]> {
  return (await scanEmbeddedMusicLibrary(rootPath, probe)).artists;
}
