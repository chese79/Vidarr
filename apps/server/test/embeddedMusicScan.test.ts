import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  artistFromEmbeddedTags,
  recordingFromEmbeddedTags,
  scanEmbeddedMusicLibrary,
} from '../src/pipeline/embeddedMusicScan.js';

const temporaryDirectories: string[] = [];
afterEach(async () => Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe('embedded Picard tag parsing', () => {
  it('prefers album artist and album-artist MBID over track artist fields', () => {
    expect(artistFromEmbeddedTags({
      ARTIST: 'Guest Singer',
      ALBUM_ARTIST: 'Canonical Band',
      MUSICBRAINZ_ARTISTID: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      MUSICBRAINZ_ALBUMARTISTID: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      GENRE: 'Alternative',
    })).toMatchObject({
      name: 'Canonical Band',
      musicbrainzArtistId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      musicbrainzSource: 'embedded',
      genre: 'Alternative',
    });
  });

  it('excludes Various Artists compilation observations', () => {
    expect(artistFromEmbeddedTags({ ALBUMARTIST: 'Various Artists' })).toBeNull();
  });

  it('retains a name-only observation when no MBID is embedded', () => {
    expect(artistFromEmbeddedTags({ artist: 'Local Artist' })).toMatchObject({
      externalId: 'embedded:local artist', name: 'Local Artist',
    });
  });

  it('retains only the release and recording identities observed in a file', () => {
    expect(recordingFromEmbeddedTags('/music/Artist/Album/02 - Song.flac', {
      TITLE: 'Song',
      ALBUM: 'Album',
      ARTIST: 'Featured Singer',
      ALBUM_ARTIST: 'Canonical Band',
      GENRE: 'Alternative',
      TRACKNUMBER: '2/12',
      DISCNUMBER: '1/2',
      MUSICBRAINZ_ARTISTID: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      MUSICBRAINZ_ALBUMARTISTID: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      MUSICBRAINZ_RECORDINGID: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      MUSICBRAINZ_ALBUMID: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      MUSICBRAINZ_RELEASEGROUPID: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    })).toEqual({
      filePath: '/music/Artist/Album/02 - Song.flac',
      title: 'Song',
      album: 'Album',
      artistName: 'Featured Singer',
      albumArtistName: 'Canonical Band',
      genre: 'Alternative',
      trackNumber: 2,
      discNumber: 1,
      musicbrainzArtistId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      musicbrainzAlbumArtistId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      musicbrainzRecordingId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      musicbrainzReleaseId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      musicbrainzReleaseGroupId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    });
  });

  it('falls back to the filename for an observed recording title', () => {
    expect(recordingFromEmbeddedTags('/music/Artist/untagged.mp3', { ARTIST: 'Artist' })).toMatchObject({
      title: 'untagged',
      artistName: 'Artist',
    });
  });
});

describe('embedded music directory scan', () => {
  it('walks recursively, ignores non-audio files, tolerates corrupt files, and deduplicates artists', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'vidarr-tags-'));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, 'album'));
    await Promise.all([
      writeFile(path.join(root, 'one.flac'), ''),
      writeFile(path.join(root, 'album', 'two.mp3'), ''),
      writeFile(path.join(root, 'album', 'broken.m4a'), ''),
      writeFile(path.join(root, 'cover.jpg'), ''),
    ]);
    const probed: string[] = [];
    const result = await scanEmbeddedMusicLibrary(root, async (filePath) => {
      probed.push(path.basename(filePath));
      if (filePath.endsWith('broken.m4a')) throw new Error('bad file');
      return {
        TITLE: path.basename(filePath),
        ARTIST: 'One Artist',
        ALBUM_ARTIST: 'One Artist',
        MUSICBRAINZ_ALBUMARTISTID: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      };
    });
    expect(probed.sort()).toEqual(['broken.m4a', 'one.flac', 'two.mp3']);
    expect(result.artists).toHaveLength(1);
    expect(result.artists[0].musicbrainzArtistId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(result.recordings).toHaveLength(2);
    expect(result.recordings.map((recording) => recording.title).sort()).toEqual(['one.flac', 'two.mp3']);
  });
});
