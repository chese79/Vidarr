import { prisma, logActivity } from '../db/client.js';
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

export interface ImportVideoSelection {
  youtubeVideoId: string;
  title: string;
  include: boolean;
}

export interface ImportArtistGroup {
  artistId: number | null; // set => assign to this existing artist; null => create one named artistName
  artistName: string;
  monitor: boolean; // the "add to watch list" checkbox — independent of whether a video is included
  videos: ImportVideoSelection[];
}

export interface CommitResult {
  artistsCreated: number;
  videosAdded: number;
  skipped: number;
}

// One group per distinct performer (grouped client-side by the same parsed
// artist name preview used — see parseArtistAndTitle) so a multi-artist
// playlist makes one new Artist per performer, not one per uploading
// channel/label. A group with no included videos needs no artist row at all.
// youtubeVideoId is already known exactly (it came straight from the
// playlist listing), so included videos skip search entirely — same
// top-priority path an IMVDb curated source takes (see pipeline/autoSearch.ts)
// — and the next backlog search / scheduled poll grabs them directly.
export async function commitYoutubePlaylistImport(
  groups: ImportArtistGroup[],
  rootFolderId: number,
  qualityProfileId: number,
): Promise<CommitResult> {
  let artistsCreated = 0;
  let videosAdded = 0;
  let skipped = 0;

  for (const group of groups) {
    const included = group.videos.filter((v) => v.include);
    skipped += group.videos.length - included.length;
    if (!included.length) continue;

    let artistId: number;
    if (group.artistId) {
      artistId = group.artistId;
      // Only ever turns monitoring ON — an unchecked box leaves an existing
      // artist's monitored status untouched rather than silently disabling it.
      if (group.monitor) {
        await prisma.artist.update({ where: { id: artistId }, data: { monitored: true } });
      }
    } else {
      const created = await prisma.artist.create({
        data: {
          name: group.artistName,
          sortName: sortNameFor(group.artistName),
          rootFolderId,
          qualityProfileId,
          monitored: group.monitor,
        },
      });
      artistId = created.id;
      await prisma.artistSource.create({
        data: { artistId, provider: 'youtube', origin: 'playlist-import' },
      });
      artistsCreated++;
    }

    for (const video of included) {
      try {
        const createdVideo = await prisma.musicVideo.create({
          data: {
            artistId,
            title: video.title,
            normalizedTitle: normalizeTitle(video.title),
            youtubeVideoId: video.youtubeVideoId,
            monitored: true,
          },
        });
        const url = `https://www.youtube.com/watch?v=${video.youtubeVideoId}`;
        await prisma.acquisitionSource.create({
          data: {
            musicVideoId: createdVideo.id,
            provider: 'youtube',
            externalId: video.youtubeVideoId,
            url,
            authority: 'manual',
            confidence: 'confirmed',
            discoveryOrigin: 'playlist-import',
            accepted: true,
          },
        });
        videosAdded++;
      } catch (err) {
        // artistId+normalizedTitle or youtubeVideoId collision — same video
        // already tracked for this artist. Not an error worth surfacing.
        skipped++;
        await logActivity('info', 'playlist-import', err);
      }
    }
  }

  return { artistsCreated, videosAdded, skipped };
}
