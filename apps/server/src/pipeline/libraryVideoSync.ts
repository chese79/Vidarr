import type { LibraryConnector, QualityProfile, RootFolder } from '@prisma/client';
import { prisma } from '../db/client.js';
import { getLibraryConnectorProvider } from '../providers/library/index.js';
import { normalizeTitle } from './normalize.js';
import { matchLibraryVideoIdentities, type CanonicalVideo, type MatchConfidence } from './reconciliation.js';
import { artistNameHint } from './artistObservation.js';
import { observedArtistName, videoIdentities, type VideoIdentity } from './videoIdentity.js';

type CanonicalArtist = { id: number; name: string; musicbrainzMatchStatus: string };

export interface VideoSyncContext {
  // The full connector sync has already looked these up while observing artists;
  // a standalone video sync fetches them itself.
  defaults?: [RootFolder | null, QualityProfile | null];
  canonicalByName?: Map<string, CanonicalArtist>;
  // Called once the connector's video list is fetched and its artists exist, just
  // before the videos are written (the full sync uses it for progress totals).
  onFetched?: (videoCount: number) => Promise<void> | void;
}

export interface VideoSyncResult {
  videoCount: number;
  // How the fetched videos reconciled with the catalog: confirmed = exact match.
  matched: { confirmed: number; probable: number; ambiguous: number; unmatched: number };
}

// Reads a connector's music-video library and reconciles it into LibraryVideo
// rows matched against the canonical catalog. This is the video half of a library
// connector sync, shared by the full sync route and by on-demand syncing before a
// playlist is built, so both behave identically. It never touches the connector's
// audio-artist observations.
//
// A server's own "artist" for a video is often an uploader channel or "Unknown
// Artist", so each video's real artist and title are worked out first (see
// videoIdentity.ts) and used for matching and for the artist records this creates.
export async function syncConnectorVideos(connector: LibraryConnector, ctx: VideoSyncContext = {}): Promise<VideoSyncResult> {
  const id = connector.id;
  const defaults = ctx.defaults ?? await Promise.all([
    prisma.rootFolder.findFirst({ orderBy: { id: 'asc' } }),
    prisma.qualityProfile.findFirst({ orderBy: { id: 'asc' } }),
  ]);
  let canonicalByName = ctx.canonicalByName;
  if (!canonicalByName) {
    canonicalByName = new Map();
    if (defaults[0] && defaults[1]) {
      const canonicalArtists = await prisma.artist.findMany({ select: { id: true, name: true, musicbrainzMatchStatus: true } });
      canonicalArtists.forEach((artist) => canonicalByName!.set(normalizeTitle(artist.name), artist));
    }
  }

  const provider = getLibraryConnectorProvider(connector.type);
  const videos = provider.fetchVideos && connector.videoLibraryId
    ? await provider.fetchVideos(connector)
    : [];
  const identitiesByVideo = new Map<string, VideoIdentity[]>();
  if (defaults[0] && defaults[1]) {
    const origin = `video-connector:${id}`;
    // What an earlier sync already recorded, so artists that have not changed cost no
    // writes. Per-artist upserts are a database round trip each — about a minute for
    // a library of a thousand artists — and were repeated in full on every sync.
    const knownSources = new Map(
      (await prisma.artistSource.findMany({
        where: { provider: connector.type, origin },
        select: { artistId: true, externalId: true },
      })).map((source) => [source.artistId, source.externalId]),
    );
    const sourcedVideoArtists = new Set<number>();
    const unchangedArtistIds: number[] = [];
    for (const video of videos) {
      // Computed against the artists known so far, which grows as this loop
      // records new ones, so a later video can attach to an artist an earlier one introduced.
      const identities = videoIdentities(video, canonicalByName);
      identitiesByVideo.set(video.externalId, identities);
      const nameHint = observedArtistName(identities);
      if (!nameHint) continue;
      const key = normalizeTitle(nameHint);
      let canonical = canonicalByName.get(key);
      if (!canonical) {
        canonical = await prisma.artist.create({
          data: {
            name: nameHint,
            sortName: nameHint.replace(/^the\s+/i, ''),
            monitored: false,
            rootFolderId: defaults[0].id,
            qualityProfileId: defaults[1].id,
          },
          select: { id: true, name: true, musicbrainzMatchStatus: true },
        });
        canonicalByName.set(key, canonical);
      }
      if (sourcedVideoArtists.has(canonical.id)) continue;
      sourcedVideoArtists.add(canonical.id);
      if (knownSources.has(canonical.id) && knownSources.get(canonical.id) === video.externalId) {
        unchangedArtistIds.push(canonical.id);
        continue;
      }
      await prisma.artistSource.upsert({
        where: { artistId_provider_origin: { artistId: canonical.id, provider: connector.type, origin } },
        update: { externalId: video.externalId, lastSeenAt: new Date() },
        create: { artistId: canonical.id, provider: connector.type, externalId: video.externalId, origin },
      });
    }
    for (let i = 0; i < unchangedArtistIds.length; i += 5000) {
      await prisma.artistSource.updateMany({
        where: { provider: connector.type, origin, artistId: { in: unchangedArtistIds.slice(i, i + 5000) } },
        data: { lastSeenAt: new Date() },
      });
    }
    // A new filename interpretation is not proof that an older artist observation
    // was disposable. Retain those records and their provenance for user review.
  }
  await ctx.onFetched?.(videos.length);

  const matched = { confirmed: 0, probable: 0, ambiguous: 0, unmatched: 0 };
  // A suddenly empty server response may mean an unavailable mount or a
  // temporary media-server indexing failure. Preserve known availability
  // until a non-empty scan can reconcile it safely.
  if (provider.fetchVideos && connector.videoLibraryId && videos.length > 0) {
    const canonicalVideos: CanonicalVideo[] = (
      await prisma.musicVideo.findMany({
        where: { catalogKind: { in: ['official', 'supplementary'] } },
        select: { id: true, title: true, releaseYear: true, durationSeconds: true, artist: { select: { name: true } } },
      })
    ).map((video) => ({
      id: video.id,
      normalizedTitle: normalizeTitle(video.title),
      normalizedArtistName: normalizeTitle(video.artist.name),
      releaseYear: video.releaseYear,
      durationSeconds: video.durationSeconds,
    }));
    // A prior sync's match must never be silently dropped just because
    // *this* sync's search misses (an artist/video rename upstream, for
    // instance) — see matchLibraryVideo's "previous" fallback. Also
    // carries each row's rejectedMusicVideoId so a human's "not that
    // one" decision from a past review sticks across syncs.
    const existingMatches = await prisma.libraryVideo.findMany({
      where: { connectorId: id },
      select: {
        externalId: true, title: true, artistName: true, releaseYear: true, durationSeconds: true, path: true,
        playCount: true, hasThumbnail: true, normalizedArtistName: true, normalizedTitle: true,
        musicVideoId: true, matchConfidence: true, rejectedMusicVideoId: true,
      },
    });
    const existingByExternalId = new Map(existingMatches.map((v) => [v.externalId, {
      ...v,
      matchConfidence: v.matchConfidence as MatchConfidence | null,
    }]));
    const planned = videos.map((video) => {
      const identities = identitiesByVideo.get(video.externalId) ?? videoIdentities(video, canonicalByName);
      const primary = identities[0];
      // Stored normalized fields follow the best identity so everything that
      // compares on them (Library counts, reconciliation) sees the real artist.
      let normalizedArtistName = primary ? normalizeTitle(primary.artistName) : normalizeTitle(artistNameHint(video.artistName));
      let normalizedTitle = primary ? normalizeTitle(primary.title) : normalizeTitle(video.title);
      const existing = existingByExternalId.get(video.externalId);
      const candidates = (identities.length ? identities : [{ artistName: artistNameHint(video.artistName), title: video.title }]).map((identity) => ({
        normalizedArtistName: normalizeTitle(identity.artistName),
        normalizedTitle: normalizeTitle(identity.title),
        releaseYear: video.releaseYear ?? null,
        durationSeconds: video.durationSeconds ?? null,
      }));
      const match = matchLibraryVideoIdentities(
        candidates,
        canonicalVideos,
        existing
          ? { musicVideoId: existing.musicVideoId, matchConfidence: existing.matchConfidence as MatchConfidence | null }
          : null,
        existing?.rejectedMusicVideoId ?? null,
      );
      // An exact fallback may come from the server title rather than the filename.
      // Store that winning identity so inventory filters agree with the matched catalog.
      if (match.musicVideoId != null && match.matchConfidence === null) {
        const winner = canonicalVideos.find((candidate) => candidate.id === match.musicVideoId);
        if (winner) {
          normalizedArtistName = winner.normalizedArtistName;
          normalizedTitle = winner.normalizedTitle;
        }
      }
      // Most rows are identical to last time. Rewriting each one is a database
      // round trip apiece (about a minute for a few thousand videos), so rows that
      // have not changed are only re-marked available, in bulk.
      const unchanged = existing !== undefined
        && existing.title === video.title
        && existing.artistName === video.artistName
        && existing.releaseYear === (video.releaseYear ?? null)
        && existing.durationSeconds === (video.durationSeconds ?? null)
        && existing.path === (video.path ?? null)
        && existing.playCount === (video.playCount ?? null)
        && existing.hasThumbnail === (video.hasThumbnail ?? false)
        && existing.normalizedArtistName === normalizedArtistName
        && existing.normalizedTitle === normalizedTitle
        && existing.musicVideoId === match.musicVideoId
        && existing.matchConfidence === match.matchConfidence;
      return { video, normalizedArtistName, normalizedTitle, match, unchanged };
    });
    for (const { match } of planned) {
      if (match.musicVideoId == null) matched.unmatched++;
      else if (match.matchConfidence === null) matched.confirmed++;
      else if (match.matchConfidence === 'probable') matched.probable++;
      else matched.ambiguous++;
    }
    const unchangedIds = planned.filter((p) => p.unchanged).map((p) => p.video.externalId);
    const UNCHANGED_CHUNK = 5000; // stays well inside SQLite's bound-parameter limit
    // The "mark everything stale, then re-mark what's still there" reset
    // must be one atomic transaction — if it were two separate
    // statements and anything after the reset threw (a bad title from
    // the remote server, a dropped connection mid-sync), the reset would
    // already be committed with nothing to undo it, leaving every video
    // for this connector marked unavailable until some future sync
    // happens to succeed end-to-end.
    await prisma.$transaction([
      prisma.libraryVideo.updateMany({ where: { connectorId: id }, data: { available: false } }),
      ...Array.from({ length: Math.ceil(unchangedIds.length / UNCHANGED_CHUNK) }, (_, i) =>
        prisma.libraryVideo.updateMany({
          where: { connectorId: id, externalId: { in: unchangedIds.slice(i * UNCHANGED_CHUNK, (i + 1) * UNCHANGED_CHUNK) } },
          data: { available: true, lastSyncedAt: new Date() },
        })),
      ...planned.filter((p) => !p.unchanged).map(({ video, normalizedArtistName, normalizedTitle, match }) => prisma.libraryVideo.upsert({
        where: { connectorId_externalId: { connectorId: id, externalId: video.externalId } },
        update: {
          title: video.title,
          normalizedTitle,
          artistName: video.artistName,
          normalizedArtistName,
          releaseYear: video.releaseYear ?? null,
          durationSeconds: video.durationSeconds ?? null,
          path: video.path ?? null,
          playCount: video.playCount ?? null,
          hasThumbnail: video.hasThumbnail ?? false,
          available: true,
          lastSyncedAt: new Date(),
          musicVideoId: match.musicVideoId,
          matchConfidence: match.matchConfidence,
        },
        create: {
          connectorId: id,
          externalId: video.externalId,
          title: video.title,
          normalizedTitle,
          artistName: video.artistName,
          normalizedArtistName,
          releaseYear: video.releaseYear ?? null,
          durationSeconds: video.durationSeconds ?? null,
          path: video.path ?? null,
          playCount: video.playCount ?? null,
          hasThumbnail: video.hasThumbnail ?? false,
          musicVideoId: match.musicVideoId,
          matchConfidence: match.matchConfidence,
        },
      })),
    ]);
    const confirmedIds = planned
      .map((p) => (p.match.matchConfidence === null ? p.match.musicVideoId : null))
      .filter((value): value is number => value != null);
    if (confirmedIds.length) {
      await prisma.musicVideo.updateMany({
        where: { id: { in: confirmedIds } },
        data: { awaitingServerScanAt: null },
      });
      await prisma.artist.updateMany({
        where: { musicVideos: { some: { id: { in: confirmedIds } } } },
        data: { reconciledAt: new Date() },
      });
    }
  }
  return { videoCount: videos.length, matched };
}
