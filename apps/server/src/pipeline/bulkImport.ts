import { prisma } from '../db/client.js';
import { listPlaylistVideos } from '../providers/youtube/ytdlp.js';
import { normalizeTitle, squash, sortNameFor } from './normalize.js';

export interface PlaylistImportCandidate {
  youtubeVideoId: string;
  title: string;
  channel: string;
  suggestedArtistName: string;
  matchedArtistId: number | null;
  matchedArtistName: string | null;
  alreadyInLibrary: boolean;
}

const QUALITY_TAG = /\s*[([]\s*(official\s*(music\s*)?video|official\s*audio|official|lyric\s*video|audio)\s*[)\]]\s*$/i;
// "Artist - Title", "Artist – Title" (en dash), "Artist — Title" (em dash).
// Requires the artist part to be reasonably short (< 60 chars) so a title
// that merely *contains* a hyphen (no real artist prefix) doesn't misfire.
const ARTIST_TITLE_SPLIT = /^(.{1,60}?)\s+[-–—]\s+(.+)$/;

// A playlist's uploading channel is frequently a label/aggregator, NOT the
// performing artist — confirmed live against a real "Various Artists"
// playlist where every video reported channel "Builders Music" despite each
// one being a different act. The title's own "Artist - Title" convention (the
// same one this app's naming pattern and Sonarr/Radarr's release parsing rely
// on) is the more reliable signal for multi-artist playlists; channel name is
// only used as a fallback when no such pattern is found (e.g. an official
// per-artist channel whose titles are just the bare song title, like remhq).
export function parseArtistAndTitle(rawTitle: string, channelFallback: string): { artist: string; title: string } {
  const withoutTag = rawTitle.replace(QUALITY_TAG, '').trim();
  const split = ARTIST_TITLE_SPLIT.exec(withoutTag);
  if (split) {
    return { artist: split[1].trim(), title: split[2].trim() };
  }
  return { artist: channelFallback, title: withoutTag };
}

// Best-effort artist match per video, same squash-based comparison
// youtubeMatch.ts uses in the other direction (artist name → channel). A
// playlist can span many artists, so — unlike a single-artist YoutubeSource
// (youtubeSync.ts) — every video needs its own match attempt.
export async function previewYoutubePlaylistImport(url: string): Promise<PlaylistImportCandidate[]> {
  const videos = await listPlaylistVideos(url);
  const artists = await prisma.artist.findMany({ select: { id: true, name: true } });
  const bySquashedName = new Map(artists.map((a) => [squash(a.name), a]));

  const existingByYoutubeId = new Set(
    (
      await prisma.musicVideo.findMany({
        where: { youtubeVideoId: { in: videos.map((v) => v.youtubeVideoId) } },
        select: { youtubeVideoId: true },
      })
    ).map((v) => v.youtubeVideoId),
  );

  return videos.map((video) => {
    const { artist: suggestedArtistName, title } = parseArtistAndTitle(video.title, video.channel);
    const match = bySquashedName.get(squash(suggestedArtistName));
    return {
      youtubeVideoId: video.youtubeVideoId,
      title,
      channel: video.channel,
      suggestedArtistName,
      matchedArtistId: match?.id ?? null,
      matchedArtistName: match?.name ?? null,
      alreadyInLibrary: existingByYoutubeId.has(video.youtubeVideoId),
    };
  });
}

export type ImportSelection =
  | { youtubeVideoId: string; title: string; suggestedArtistName: string; action: 'skip' }
  | { youtubeVideoId: string; title: string; suggestedArtistName: string; action: 'assign'; artistId: number }
  | { youtubeVideoId: string; title: string; suggestedArtistName: string; action: 'create' };

export interface CommitResult {
  artistsCreated: number;
  videosAdded: number;
  skipped: number;
}

// 'create' actions are grouped by the parsed artist name (not the raw
// channel — see parseArtistAndTitle) so a multi-artist playlist makes one new
// Artist per distinct performer, not one per uploading channel/label.
// youtubeVideoId is already known exactly (it came straight from the
// playlist listing), so these videos skip search entirely — same
// top-priority path an IMVDb curated source takes (see pipeline/autoSearch.ts)
// — and the next backlog search / scheduled poll grabs them directly.
export async function commitYoutubePlaylistImport(
  selections: ImportSelection[],
  rootFolderId: number,
  qualityProfileId: number,
): Promise<CommitResult> {
  const createdArtistIdByName = new Map<string, number>();
  let artistsCreated = 0;
  let videosAdded = 0;
  let skipped = 0;

  for (const selection of selections) {
    if (selection.action === 'skip') {
      skipped++;
      continue;
    }

    let artistId: number;
    if (selection.action === 'assign') {
      artistId = selection.artistId;
    } else {
      const key = squash(selection.suggestedArtistName);
      const existing = createdArtistIdByName.get(key);
      if (existing) {
        artistId = existing;
      } else {
        const created = await prisma.artist.create({
          data: {
            name: selection.suggestedArtistName,
            sortName: sortNameFor(selection.suggestedArtistName),
            rootFolderId,
            qualityProfileId,
          },
        });
        createdArtistIdByName.set(key, created.id);
        artistId = created.id;
        artistsCreated++;
      }
    }

    try {
      await prisma.musicVideo.create({
        data: {
          artistId,
          title: selection.title,
          normalizedTitle: normalizeTitle(selection.title),
          youtubeVideoId: selection.youtubeVideoId,
          monitored: true,
        },
      });
      videosAdded++;
    } catch (err) {
      // artistId+normalizedTitle or youtubeVideoId collision — same video
      // already tracked for this artist. Not an error worth surfacing.
      skipped++;
      await prisma.activityLog.create({
        data: { level: 'info', source: 'playlist-import', message: (err as Error).message },
      });
    }
  }

  return { artistsCreated, videosAdded, skipped };
}
