import type { FastifyInstance } from 'fastify';
import { CreateLibraryConnectorSchema, UpdateLibraryConnectorSchema, DiscoverLibraryConnectorBodySchema } from '@vidarr/shared-types';
import { prisma } from '../db/client.js';
import { getLibraryConnectorProvider } from '../providers/library/index.js';
import { normalizeTitle } from '../pipeline/normalize.js';
import { syncPlayCounts } from '../pipeline/playCountSync.js';
import { discoverPlexServers, discoverJellyfinServers } from '../pipeline/discovery.js';
import { refreshRecommendations } from '../pipeline/recommendations.js';
import { matchLibraryVideo, type CanonicalVideo, type MatchConfidence } from '../pipeline/reconciliation.js';
import { resolveArtistIdentityAndCatalog } from '../pipeline/artistIdentity.js';
import { scanEmbeddedMusicLibrary } from '../pipeline/embeddedMusicScan.js';
import { syncLibraryRecordings } from '../pipeline/libraryRecordingSync.js';

export async function libraryConnectorRoutes(app: FastifyInstance) {
  app.get('/api/v1/libraryconnector', async () => {
    return (await prisma.libraryConnector.findMany()).map(serializeConnector);
  });

  app.get('/api/v1/libraryvideo', async () => {
    const videos = await prisma.libraryVideo.findMany({
      where: { available: true, connector: { enabled: true } },
      include: {
        connector: { select: { name: true, type: true } },
        musicVideo: { select: { title: true, releaseYear: true, artist: { select: { name: true } } } },
      },
      orderBy: [{ artistName: 'asc' }, { title: 'asc' }],
    });
    // matchedVideo lets the "Needs review" UI show a side-by-side comparison
    // without a second query — only meaningful when matchConfidence is set
    // (a fuzzy, unreviewed match); an exact/confident match doesn't need it.
    return videos.map(({ musicVideo, ...video }) => ({
      ...video,
      matchedVideo: musicVideo
        ? { title: musicVideo.title, releaseYear: musicVideo.releaseYear, artistName: musicVideo.artist.name }
        : null,
    }));
  });

  // Accepts a fuzzy match a sync proposed — clears matchConfidence so the row
  // behaves exactly like an exact match everywhere else in the app from now
  // on (computeVideoStatus and every other consumer only look at
  // musicVideoId, never matchConfidence).
  app.post<{ Params: { id: string } }>('/api/v1/libraryvideo/:id/confirm-match', async (req, reply) => {
    const id = Number(req.params.id);
    const video = await prisma.libraryVideo.findUnique({ where: { id } });
    if (!video) return reply.code(404).send({ error: 'Library video not found' });
    if (!video.musicVideoId) return reply.code(400).send({ error: 'This row has no proposed match to confirm' });
    return prisma.libraryVideo.update({ where: { id }, data: { matchConfidence: null } });
  });

  // Rejects a fuzzy match: clears it and remembers it so the next sync's
  // fuzzy fallback doesn't immediately re-propose the same candidate.
  app.post<{ Params: { id: string } }>('/api/v1/libraryvideo/:id/reject-match', async (req, reply) => {
    const id = Number(req.params.id);
    const video = await prisma.libraryVideo.findUnique({ where: { id } });
    if (!video) return reply.code(404).send({ error: 'Library video not found' });
    if (!video.musicVideoId) return reply.code(400).send({ error: 'This row has no proposed match to reject' });
    return prisma.libraryVideo.update({
      where: { id },
      data: { musicVideoId: null, matchConfidence: null, rejectedMusicVideoId: video.musicVideoId },
    });
  });

  app.get<{ Params: { id: string } }>('/api/v1/libraryvideo/:id/thumbnail', async (req, reply) => {
    const video = await prisma.libraryVideo.findUnique({
      where: { id: Number(req.params.id) },
      include: { connector: true },
    });
    if (!video?.available || !video.hasThumbnail) {
      return reply.code(404).send({ error: 'Thumbnail not found' });
    }
    const provider = getLibraryConnectorProvider(video.connector.type);
    if (!provider.fetchVideoThumbnail) {
      return reply.code(404).send({ error: 'Thumbnail not supported' });
    }
    const thumbnail = await provider.fetchVideoThumbnail(video.connector, video.externalId);
    if (!thumbnail) return reply.code(404).send({ error: 'Thumbnail not found' });
    return reply
      .header('Content-Type', thumbnail.contentType)
      .header('Cache-Control', 'private, max-age=3600')
      .send(thumbnail.data);
  });

  // Broadcasts a UDP discovery request on the local network and returns
  // whatever Plex/Jellyfin servers answer — purely a convenience for the "Add
  // connector" form so the host field can be filled in instead of typed by
  // hand. No equivalent protocol exists for Subsonic/Navidrome.
  app.post('/api/v1/libraryconnector/discover', async (req) => {
    const body = DiscoverLibraryConnectorBodySchema.parse(req.body);
    if (body.type === 'plex') return discoverPlexServers();
    return discoverJellyfinServers();
  });

  app.post('/api/v1/libraryconnector', async (req, reply) => {
    const body = CreateLibraryConnectorSchema.parse(req.body);
    const created = await prisma.libraryConnector.create({
      data: {
        name: body.name,
        type: body.type,
        host: body.host,
        authToken: body.authToken ?? null,
        username: body.username ?? null,
        password: body.password ?? null,
        musicLibraryId: body.musicLibraryId ?? null,
        musicPath: body.musicPath ?? null,
        videoLibraryId: body.videoLibraryId ?? null,
        enabled: body.enabled,
      },
    });
    reply.code(201);
    return serializeConnector(created);
  });

  // Lists the connector's library sections so the UI can offer a picker for
  // videoLibraryId — the section holding vidarr's own downloaded videos,
  // which is deliberately never guessed (see providers/library/plex.ts).
  app.get('/api/v1/libraryconnector/:id/sections', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const connector = await prisma.libraryConnector.findUnique({ where: { id } });
    if (!connector) return reply.code(404).send({ error: 'Connector not found' });

    const provider = getLibraryConnectorProvider(connector.type);
    if (!provider.listSections) return [];
    try {
      return await provider.listSections(connector);
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  app.put('/api/v1/libraryconnector/:id', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const body = UpdateLibraryConnectorSchema.parse(req.body);
    return serializeConnector(await prisma.libraryConnector.update({ where: { id }, data: body }));
  });

  app.delete('/api/v1/libraryconnector/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    await prisma.libraryConnector.delete({ where: { id } });
    reply.code(204);
  });

  app.post('/api/v1/libraryconnector/:id/test', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const connector = await prisma.libraryConnector.findUnique({ where: { id } });
    if (!connector) return reply.code(404).send({ error: 'Connector not found' });

    const result = await getLibraryConnectorProvider(connector.type).testConnection(connector);
    // musicLibraryId is now a deliberate user choice (see the music-library
    // picker in LibraryConnectorsPage.tsx) — only auto-fill it from Test when
    // nothing has been picked yet. Plex's testConnection always guesses the
    // first "artist" section, so persisting it unconditionally on every Test
    // would silently overwrite a different section the user picked on
    // purpose. userId is never user-chosen (it's resolved from `username`),
    // so it's always safe, and desirable, to keep it fresh.
    const updates: { musicLibraryId?: string; userId?: string } = {};
    if (result.musicLibraryId && !connector.musicLibraryId) updates.musicLibraryId = result.musicLibraryId;
    if (result.userId) updates.userId = result.userId;
    if (Object.keys(updates).length) {
      await prisma.libraryConnector.update({ where: { id }, data: updates });
    }
    return { ok: result.ok, message: result.message };
  });

  app.post('/api/v1/libraryconnector/:id/sync', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const connector = await prisma.libraryConnector.findUnique({ where: { id } });
    if (!connector) return reply.code(404).send({ error: 'Connector not found' });

    await prisma.libraryConnector.update({
      where: { id },
      data: { syncRunning: true, syncProcessed: 0, syncTotal: null, lastSyncError: null },
    });
    try {
      const syncStartedAt = new Date();
      const connectorArtists = await getLibraryConnectorProvider(connector.type).fetchArtists(connector);
      const embeddedScan = connector.musicPath
        ? await scanEmbeddedMusicLibrary(connector.musicPath)
        : { artists: [], recordings: [] };
      const embeddedArtists = embeddedScan.artists;
      const artistsByName = new Map(connectorArtists.map((artist) => [normalizeTitle(artist.name), artist]));
      for (const embedded of embeddedArtists) {
        const key = normalizeTitle(embedded.name);
        const existing = artistsByName.get(key);
        artistsByName.set(key, {
          ...existing,
          ...embedded,
          externalId: existing?.externalId ?? embedded.externalId,
          // Connector play counts remain useful; embedded tags do not carry
          // one. Picard identity and genre win over lower-authority server
          // metadata when the same artist was observed by both.
          playCount: existing?.playCount,
          genre: embedded.genre ?? existing?.genre,
        });
      }
      const artists = [...artistsByName.values()];
      await prisma.libraryConnector.update({ where: { id }, data: { syncTotal: artists.length, syncProcessed: 0 } });
      await prisma.$transaction(artists.map((artist) =>
        prisma.libraryArtist.upsert({
          where: { connectorId_externalId: { connectorId: id, externalId: artist.externalId } },
          update: {
            name: artist.name,
            normalizedName: normalizeTitle(artist.name),
            genre: artist.genre ?? null,
            playCount: artist.playCount ?? null,
            musicbrainzArtistId: artist.musicbrainzArtistId ?? null,
            musicbrainzSource: artist.musicbrainzSource ?? null,
            lastSyncedAt: new Date(),
          },
          create: {
            connectorId: id,
            externalId: artist.externalId,
            name: artist.name,
            normalizedName: normalizeTitle(artist.name),
            genre: artist.genre ?? null,
            playCount: artist.playCount ?? null,
            musicbrainzArtistId: artist.musicbrainzArtistId ?? null,
            musicbrainzSource: artist.musicbrainzSource ?? null,
          },
        }),
      ));
      await prisma.libraryConnector.update({ where: { id }, data: { syncProcessed: artists.length } });
      // Only prune rows the fetch didn't touch when the fetch actually
      // returned something — an empty `artists` array almost always means a
      // transient glitch (auth hiccup, momentarily-empty response, a renamed
      // section) rather than "the library is now empty," and treating it as
      // the latter would wipe every previously-synced artist for this
      // connector on a single bad response.
      if (artists.length > 0) {
        await prisma.libraryArtist.deleteMany({
          where: { connectorId: id, lastSyncedAt: { lt: syncStartedAt } },
        });
      }
      if (connector.musicPath) {
        await syncLibraryRecordings(id, embeddedScan.recordings, syncStartedAt);
      }

      // Observations establish artists before either metadata catalog is
      // queried. This order is intentional: inventory is reconciled against
      // a catalog derived from a confirmed artist identity, never the other
      // way around.
      const defaults = await Promise.all([
        prisma.rootFolder.findFirst({ orderBy: { id: 'asc' } }),
        prisma.qualityProfile.findFirst({ orderBy: { id: 'asc' } }),
      ]);
      const canonicalByName = new Map<string, { id: number; name: string }>();
      if (defaults[0] && defaults[1]) {
        const canonicalArtists = await prisma.artist.findMany({ select: { id: true, name: true } });
        canonicalArtists.forEach((artist) => canonicalByName.set(normalizeTitle(artist.name), artist));
        const existingSources = await prisma.artistSource.findMany({
          where: { provider: connector.type, origin: `connector:${id}`, externalId: { not: null } },
          select: { externalId: true, artist: { select: { id: true, name: true } } },
        });
        const canonicalByExternalId = new Map(existingSources.map((source) => [source.externalId!, source.artist]));
        for (const observation of artists) {
          const key = normalizeTitle(observation.name);
          // Stable connector identity wins over a display name. MusicBrainz
          // enrichment may rename an artist to its canonical spelling; the
          // next connector sync must update that artist, not recreate the old
          // spelling as a duplicate.
          let canonical = canonicalByExternalId.get(observation.externalId) ?? canonicalByName.get(key);
          if (!canonical) {
            canonical = await prisma.artist.create({
              data: {
                name: observation.name,
                sortName: observation.name.replace(/^the\s+/i, ''),
                monitored: false,
                rootFolderId: defaults[0].id,
                qualityProfileId: defaults[1].id,
              },
              select: { id: true, name: true },
            });
            canonicalByName.set(key, canonical);
          }
          canonicalByExternalId.set(observation.externalId, canonical);
          await prisma.artistSource.upsert({
            where: { artistId_provider_origin: { artistId: canonical.id, provider: connector.type, origin: `connector:${id}` } },
            update: { externalId: observation.externalId, lastSeenAt: new Date() },
            create: { artistId: canonical.id, provider: connector.type, externalId: observation.externalId, origin: `connector:${id}` },
          });
          // Only stable provider/embedded MBIDs auto-confirm during a library
          // sync. Name-only observations stay unmatched until candidate
          // discovery can present them for review.
          if (observation.musicbrainzArtistId) {
            await resolveArtistIdentityAndCatalog(canonical.id, observation);
          }
        }
      }

      const provider = getLibraryConnectorProvider(connector.type);
      const videos = provider.fetchVideos && connector.videoLibraryId
        ? await provider.fetchVideos(connector)
        : [];
      if (defaults[0] && defaults[1]) {
        for (const video of videos) {
          const key = normalizeTitle(video.artistName);
          if (!key || canonicalByName.has(key)) continue;
          const canonical = await prisma.artist.create({
            data: {
              name: video.artistName,
              sortName: video.artistName.replace(/^the\s+/i, ''),
              monitored: false,
              rootFolderId: defaults[0].id,
              qualityProfileId: defaults[1].id,
            },
            select: { id: true, name: true },
          });
          canonicalByName.set(key, canonical);
          await prisma.artistSource.create({
            data: { artistId: canonical.id, provider: connector.type, externalId: video.externalId, origin: `video-connector:${id}` },
          });
        }
      }
      await prisma.libraryConnector.update({
        where: { id },
        data: { syncTotal: artists.length + videos.length },
      });
      if (provider.fetchVideos && connector.videoLibraryId) {
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
          select: { externalId: true, musicVideoId: true, matchConfidence: true, rejectedMusicVideoId: true },
        });
        const existingByExternalId = new Map(existingMatches.map((v) => [v.externalId, {
          ...v,
          matchConfidence: v.matchConfidence as MatchConfidence | null,
        }]));
        // The "mark everything stale, then re-mark what's still there" reset
        // must be one atomic transaction — if it were two separate
        // statements and anything after the reset threw (a bad title from
        // the remote server, a dropped connection mid-sync), the reset would
        // already be committed with nothing to undo it, leaving every video
        // for this connector marked unavailable until some future sync
        // happens to succeed end-to-end.
        await prisma.$transaction([
          prisma.libraryVideo.updateMany({ where: { connectorId: id }, data: { available: false } }),
          ...videos.map((video) => {
            const normalizedArtistName = normalizeTitle(video.artistName);
            const normalizedTitle = normalizeTitle(video.title);
            const existing = existingByExternalId.get(video.externalId);
            const match = matchLibraryVideo(
              {
                normalizedArtistName,
                normalizedTitle,
                releaseYear: video.releaseYear ?? null,
                durationSeconds: video.durationSeconds ?? null,
              },
              canonicalVideos,
              existing
                ? { musicVideoId: existing.musicVideoId, matchConfidence: existing.matchConfidence as MatchConfidence | null }
                : null,
              existing?.rejectedMusicVideoId ?? null,
            );
            return prisma.libraryVideo.upsert({
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
            });
          }),
        ]);
        const confirmedIds = videos
          .map((video) => {
            const match = matchLibraryVideo(
              {
                normalizedArtistName: normalizeTitle(video.artistName),
                normalizedTitle: normalizeTitle(video.title),
                releaseYear: video.releaseYear ?? null,
                durationSeconds: video.durationSeconds ?? null,
              },
              canonicalVideos,
              existingByExternalId.get(video.externalId) ?? null,
              existingByExternalId.get(video.externalId)?.rejectedMusicVideoId ?? null,
            );
            return match.matchConfidence === null ? match.musicVideoId : null;
          })
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

      // Backfill vidarr's own Artist.genre from this connector's synced data
      // when we don't already have one — never overwrites a user-set or
      // previously-matched genre. Matched by normalized name, same
      // comparison used everywhere else in this codebase.
      const genreByNormalizedName = new Map(
        artists.filter((a) => a.genre).map((a) => [normalizeTitle(a.name), a.genre as string]),
      );
      if (genreByNormalizedName.size) {
        const genrelessArtists = await prisma.artist.findMany({
          where: { genre: null },
          select: { id: true, name: true },
        });
        for (const a of genrelessArtists) {
          const genre = genreByNormalizedName.get(normalizeTitle(a.name));
          if (genre) await prisma.artist.update({ where: { id: a.id }, data: { genre } });
        }
      }

      await prisma.libraryConnector.update({
        where: { id },
        data: {
          lastSyncedAt: new Date(),
          lastSyncStatus: 'success',
          lastSyncError: null,
          syncRunning: false,
          syncProcessed: artists.length + videos.length,
          syncTotal: artists.length + videos.length,
        },
      });
      const recommendations = await refreshRecommendations();
      return {
        ok: true,
        artistCount: artists.length,
        videoCount: videos.length,
        recordingCount: embeddedScan.recordings.length,
        recommendationCount: recommendations.totalRecommendations,
      };
    } catch (err) {
      await prisma.libraryConnector.update({
        where: { id },
        data: {
          lastSyncedAt: new Date(),
          lastSyncStatus: 'failed',
          lastSyncError: (err as Error).message,
          syncRunning: false,
        },
      });
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  app.post('/api/v1/libraryconnector/:id/sync-play-counts', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    try {
      return await syncPlayCounts(id);
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });
}

function serializeConnector<T extends { authToken: string | null; password: string | null }>(connector: T) {
  const { authToken, password: _password, ...safe } = connector;
  return { ...safe, authToken: null, hasAuthToken: Boolean(authToken) };
}
