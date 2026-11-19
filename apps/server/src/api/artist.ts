import { getArtistSummary } from '../catalog/artistSummary.js';
import { escapeLikeTerm } from '../db/sqlPatterns.js';
import { ACTIVE_DOWNLOAD_STATUSES } from '../media/lifecycle.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import {
  CreateArtistSchema,
  UpdateArtistSchema,
  ArtistSummaryQuerySchema,
  BulkMonitorArtistsBodySchema,
  BulkArtistIdsBodySchema,
} from '@vidarr/shared-types';
import { prisma, readPrisma, logActivity } from '../db/client.js';
import { sortNameFor, normalizeTitle } from '../pipeline/normalize.js';
import { refreshArtistMetadata } from '../pipeline/metadataRefresh.js';
import { matchStandardGenre } from '../pipeline/genreMatch.js';
import { setUserGenres } from '../pipeline/artistGenres.js';
import { parseGenreList } from '../pipeline/genreTaxonomy.js';
import { getLibraryConnectorProvider } from '../providers/library/index.js';
import { fetchImageSafely } from '../pipeline/safeImageFetch.js';
import { computeVideoStatus, effectivePlayCount } from '../pipeline/videoStatus.js';
import { matchLibraryVideo, type CanonicalVideo } from '../pipeline/reconciliation.js';
import { autoSearchAndGrab, previewBacklogSearch, runBacklogSearch } from '../pipeline/autoSearch.js';
import { confirmArtistIdentity, discoverArtistIdentityCandidates } from '../pipeline/artistIdentity.js';
import { collectArtistVideoInventory, queueArtistVideoInventory } from '../pipeline/artistVideoInventory.js';
import { lookupMusicBrainzArtist, searchMusicBrainzArtists } from '../providers/metadata/musicbrainz.js';
import { validateNewArtist } from '../pipeline/newArtistValidation.js';

async function loadArtistReview(search?: string, offset = 0, limit?: number) {
  const predicate = Prisma.sql`a."musicbrainzMatchStatus" NOT IN ('confirmed', 'linked')
    ${search ? Prisma.sql`AND a."name" LIKE ${`%${escapeLikeTerm(search)}%`} ESCAPE '\\'` : Prisma.empty}`;
  const [count, ranks] = await Promise.all([
    readPrisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`SELECT COUNT(*) AS total FROM "Artist" a WHERE ${predicate}`),
    readPrisma.$queryRaw<Array<{ id: number; suggestedMatchCount: bigint }>>(Prisma.sql`
      SELECT a."id", (SELECT COUNT(*) FROM "MusicBrainzArtistCandidate" c
        WHERE c."artistId" = a."id" AND c."status" = 'suggested') AS suggestedMatchCount
      FROM "Artist" a WHERE ${predicate}
      ORDER BY suggestedMatchCount DESC, a."sortName" ASC, a."id" ASC
      ${limit !== undefined ? Prisma.sql`LIMIT ${limit} OFFSET ${offset}` : Prisma.empty}`),
  ]);
  const artists = await prisma.artist.findMany({
    where: { id: { in: ranks.map((row) => row.id) } },
    include: { musicbrainzCandidates: { where: { status: 'suggested' }, orderBy: [{ score: 'desc' }, { id: 'asc' }], take: 3 } },
  });
  const byId = new Map(artists.map((artist) => [artist.id, artist]));
  return { total: Number(count[0].total), items: ranks.flatMap((row) => {
    const artist = byId.get(row.id);
    return artist ? [{ ...artist, suggestedMatchCount: Number(row.suggestedMatchCount) }] : [];
  }) };
}

export async function artistRoutes(app: FastifyInstance) {
  app.post('/api/v1/artist/:id/confirm-genres-download-all', async (req, reply) => {
    const id = z.coerce.number().int().positive().parse((req.params as { id: string }).id);
    const { genres } = z.object({ genres: z.array(z.string().trim().min(1).max(80)).min(1).max(30) }).parse(req.body);
    const artist = await prisma.artist.findUnique({ where: { id } });
    if (!artist) return reply.code(404).send({ error: 'Artist not found' });
    if (artist.musicbrainzMatchStatus !== 'confirmed' || !artist.musicbrainzArtistId) {
      return reply.code(409).send({ error: 'Confirm the MusicBrainz artist before downloading its videos' });
    }
    await setUserGenres(id, genres);
    const sourceErrors: string[] = [];
    try { sourceErrors.push(...(await collectArtistVideoInventory(id)).errors); }
    catch (error) { sourceErrors.push('Source collection failed; using the existing catalog.'); await logActivity('warn', 'discover:download-all:sources', error); }
    const [, monitored] = await prisma.$transaction([
      prisma.artist.update({ where: { id }, data: { monitored: true } }),
      prisma.musicVideo.updateMany({ where: { artistId: id }, data: { monitored: true, ignored: false } }),
    ]);
    const wanted = await prisma.musicVideo.findMany({ where: {
      artistId: id, catalogKind: { not: 'inventory' }, hasFile: false, awaitingServerScanAt: null,
      libraryVideos: { none: { available: true, matchConfidence: null, connector: { enabled: true } } },
      queueItems: { none: { status: { in: [...ACTIVE_DOWNLOAD_STATUSES] } } },
    }, select: { id: true }, orderBy: { id: 'asc' } });
    let grabbed = 0;
    const failures: Array<{ musicVideoId: number; reason: string }> = [];
    for (const video of wanted) {
      try {
        const result = await autoSearchAndGrab(video.id);
        if (result.grabbed) grabbed++;
        else failures.push({ musicVideoId: video.id, reason: result.reason });
      } catch (error) {
        failures.push({ musicVideoId: video.id, reason: 'Search/download failed; video remains monitored for retry.' });
        await logActivity('warn', 'discover:download-all', error);
      }
    }
    return { monitoredCount: monitored.count, searchedCount: wanted.length, grabbed, skipped: failures.length, failures, sourceErrors };
  });

  app.post('/api/v1/artist/validate-new', async (req) => {
    const { name } = z.object({ name: z.string().trim().min(1).max(120) }).parse(req.body);
    return validateNewArtist(name);
  });
  app.post('/api/v1/artist/add-new', async (req, reply) => {
    const body = z.object({ name: z.string().trim().min(1).max(120), rootFolderId: z.number().int().positive(), qualityProfileId: z.number().int().positive(), allowUnverified: z.boolean().default(false) }).parse(req.body);
    const [root, profile] = await Promise.all([prisma.rootFolder.findUnique({ where: { id: body.rootFolderId } }), prisma.qualityProfile.findUnique({ where: { id: body.qualityProfileId } })]);
    if (!root || !profile) return reply.code(400).send({ error: 'Select a root folder and quality profile first' });
    const validation = await validateNewArtist(body.name);
    if (!validation.validated || !validation.musicbrainzArtistId) return reply.code(409).send({ error: 'Select a validated MusicBrainz artist before adding it.', validation });
    const existing = validation.musicbrainzArtistId
      ? await prisma.artist.findUnique({ where: { musicbrainzArtistId: validation.musicbrainzArtistId } })
      : await prisma.artist.findFirst({ where: { name: body.name } });
    const artist = existing ?? await prisma.artist.create({ data: {
      name: body.name, sortName: sortNameFor(body.name), rootFolderId: body.rootFolderId, qualityProfileId: body.qualityProfileId,
      musicbrainzArtistId: validation.musicbrainzArtistId, musicbrainzMatchStatus: validation.musicbrainzArtistId ? 'confirmed' : 'unmatched',
      musicbrainzMatchConfidence: validation.musicbrainzArtistId ? 1 : null,
      imvdbArtistId: validation.imvdbArtistId && !await prisma.artist.findUnique({ where: { imvdbArtistId: validation.imvdbArtistId } }) ? validation.imvdbArtistId : null,
      monitored: false,
    } });
    await prisma.artistSource.upsert({ where: { artistId_provider_origin: { artistId: artist.id, provider: 'manual', origin: 'discover-add' } }, update: { lastSeenAt: new Date() }, create: { artistId: artist.id, provider: 'manual', origin: 'discover-add' } });
    if (artist.musicbrainzArtistId) {
      void collectArtistVideoInventory(artist.id, { enrichIdentity: true }).catch((error) => logActivity('warn', 'discover:add', error));
    }
    return { artist, validation };
  });

  app.get('/api/v1/artist/musicbrainz/search', async (req, reply) => {
    const { q } = z.object({ q: z.string().trim().min(1).max(120) }).parse(req.query);
    try { return await searchMusicBrainzArtists(q, 20); }
    catch (error) { return reply.code(502).send({ error: (error as Error).message }); }
  });

  app.post('/api/v1/artist/musicbrainz/add', async (req, reply) => {
    const body = z.object({ musicbrainzArtistId: z.string().uuid(), rootFolderId: z.number().int().positive(), qualityProfileId: z.number().int().positive() }).parse(req.body);
    const mbid = body.musicbrainzArtistId.toLowerCase();
    const [root, profile] = await Promise.all([
      prisma.rootFolder.findUnique({ where: { id: body.rootFolderId } }),
      prisma.qualityProfile.findUnique({ where: { id: body.qualityProfileId } }),
    ]);
    if (!root || !profile) return reply.code(400).send({ error: 'Select a root folder and quality profile first' });
    try {
      const metadata = await lookupMusicBrainzArtist(mbid);
      const artist = await prisma.artist.upsert({
        where: { musicbrainzArtistId: mbid }, update: { musicbrainzMatchStatus: 'confirmed', musicbrainzMatchConfidence: 1 },
        create: { name: metadata.name, sortName: metadata.sortName, musicbrainzArtistId: mbid,
          musicbrainzMatchStatus: 'confirmed', musicbrainzMatchConfidence: 1, monitored: false,
          rootFolderId: body.rootFolderId, qualityProfileId: body.qualityProfileId },
      });
      await prisma.artistSource.upsert({
        where: { artistId_provider_origin: { artistId: artist.id, provider: 'musicbrainz', origin: 'discover-review' } },
        update: { lastSeenAt: new Date() },
        create: { artistId: artist.id, provider: 'musicbrainz', externalId: mbid, origin: 'discover-review' },
      });
      // Return the identity promptly; collect every catalog source in the background.
      // The persistent confirmed-artist backfill also retries unfinished collections.
      void collectArtistVideoInventory(artist.id, { enrichIdentity: true, metadata }).catch((error) => logActivity('warn', 'discover:review', error));
      return artist;
    } catch (error) { return reply.code(502).send({ error: (error as Error).message }); }
  });

  app.get('/api/v1/artist', async () => {
    return prisma.artist.findMany({
      where: { musicbrainzMatchStatus: 'confirmed', musicbrainzArtistId: { not: null } },
      orderBy: { sortName: 'asc' },
    });
  });

  app.get('/api/v1/artist/match-review', async () => {
    return (await loadArtistReview()).items;
  });

  app.get('/api/v1/artist/match-review/page', async (req) => {
    const query = req.query as { offset?: string; limit?: string; search?: string };
    const offset = Math.max(0, Number.parseInt(query.offset ?? '0', 10) || 0);
    const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit ?? '25', 10) || 25));
    const search = query.search?.trim().slice(0, 100);
    const { total, items } = await loadArtistReview(search, offset, limit);
    return { total, offset, limit, items };
  });

  app.get('/api/v1/artist/:id/musicbrainz/candidates', async (req) => {
    const id = Number((req.params as { id: string }).id);
    return prisma.musicBrainzArtistCandidate.findMany({
      where: { artistId: id, status: 'suggested' },
      orderBy: { score: 'desc' },
    });
  });

  app.post('/api/v1/artist/:id/musicbrainz/discover', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const searchName = (req.body as { searchName?: string } | null)?.searchName?.trim();
    if (searchName && searchName.length > 120) return reply.code(400).send({ error: 'Search name is too long' });
    if (!await prisma.artist.findUnique({ where: { id }, select: { id: true } })) {
      return reply.code(404).send({ error: 'Artist not found' });
    }
    return discoverArtistIdentityCandidates(id, searchName);
  });

  app.post('/api/v1/artist/:id/musicbrainz/confirm', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const musicbrainzArtistId = (req.body as { musicbrainzArtistId?: string } | null)?.musicbrainzArtistId;
    if (!musicbrainzArtistId || !/^[0-9a-f-]{36}$/i.test(musicbrainzArtistId)) {
      return reply.code(400).send({ error: 'A valid MusicBrainz artist id is required' });
    }
    if (!await prisma.artist.findUnique({ where: { id }, select: { id: true } })) {
      return reply.code(404).send({ error: 'Artist not found' });
    }
    try { return await confirmArtistIdentity(id, musicbrainzArtistId.toLowerCase()); }
    catch (error) {
      const message = (error as Error).message;
      return reply.code(message.includes('already in Library') ? 409 : 502).send({ error: message });
    }
  });

  app.get('/api/v1/artist/:id/video-inventory', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const artist = await prisma.artist.findUnique({ where: { id }, select: {
      id: true, musicbrainzMatchStatus: true, videoInventoryCheckedAt: true, videoInventoryError: true,
      videoInventoryStatus: true, videoInventoryAttemptedAt: true, videoInventoryCompletedAt: true,
    } });
    if (!artist) return reply.code(404).send({ error: 'Artist not found' });
    if (artist.musicbrainzMatchStatus !== 'confirmed') return reply.code(409).send({ error: 'Artist needs MusicBrainz confirmation' });
    const [catalog, candidates, channels] = await Promise.all([
      prisma.musicVideo.findMany({ where: { artistId: id }, select: {
        id: true, title: true, releaseYear: true, catalogKind: true, imvdbVideoId: true, youtubeVideoId: true,
        hasFile: true, file: { select: { path: true } },
      }, orderBy: [{ releaseYear: 'desc' }, { title: 'asc' }] }),
      prisma.videoReviewCandidate.findMany({ where: { artistId: id }, select: {
        id: true, source: true, title: true, url: true, filePath: true, decision: true, reason: true,
      }, orderBy: [{ source: 'asc' }, { title: 'asc' }] }),
      prisma.youtubeSource.findMany({ where: { artistId: id }, select: { id: true, url: true, lastPolledAt: true } }),
    ]);
    return { catalog, candidates, channels, checkedAt: artist.videoInventoryCheckedAt, error: artist.videoInventoryError,
      status: artist.videoInventoryStatus, attemptedAt: artist.videoInventoryAttemptedAt, completedAt: artist.videoInventoryCompletedAt };
  });

  app.get('/api/v1/artist/:id/video-inventory/summary', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const artist = await prisma.artist.findUnique({ where: { id }, select: {
      musicbrainzMatchStatus: true, videoInventoryCheckedAt: true, videoInventoryError: true,
      videoInventoryStatus: true, videoInventoryAttemptedAt: true, videoInventoryCompletedAt: true,
    } });
    if (!artist) return reply.code(404).send({ error: 'Artist not found' });
    if (artist.musicbrainzMatchStatus !== 'confirmed') return reply.code(409).send({ error: 'Artist needs MusicBrainz confirmation' });
    const [official, approvedOther, pendingYoutube, pendingLocal, channels] = await Promise.all([
      prisma.musicVideo.count({ where: { artistId: id, catalogKind: 'official' } }),
      prisma.musicVideo.count({ where: { artistId: id, catalogKind: { not: 'official' } } }),
      prisma.videoReviewCandidate.count({ where: { artistId: id, source: 'youtube', decision: 'pending' } }),
      prisma.videoReviewCandidate.count({ where: { artistId: id, source: 'local', decision: 'pending' } }),
      prisma.youtubeSource.findMany({ where: { artistId: id }, select: { id: true, url: true, lastPolledAt: true } }),
    ]);
    return { official, approvedOther, pendingYoutube, pendingLocal, channels,
      checkedAt: artist.videoInventoryCheckedAt, error: artist.videoInventoryError,
      status: artist.videoInventoryStatus, attemptedAt: artist.videoInventoryAttemptedAt, completedAt: artist.videoInventoryCompletedAt };
  });

  app.post('/api/v1/artist/:id/video-inventory/collect', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!await prisma.artist.findUnique({ where: { id }, select: { id: true } })) {
      return reply.code(404).send({ error: 'Artist not found' });
    }
    try { return await collectArtistVideoInventory(id, { enrichIdentity: true }); }
    catch (error) { return reply.code(409).send({ error: (error as Error).message }); }
  });

  // Powers the Library page's artist-centered list — combines the counts a
  // row needs (known/available/missing/downloading, aggregate play count)
  // with search/genre/monitored/letter/count filters and pagination.
  // Deliberately separate from `GET /api/v1/artist` above (PlaylistsPage's
  // artist picker still wants the plain, unfiltered list) rather than
  // changing that route's shape.
  //
  app.get('/api/v1/artist/summary', async req => getArtistSummary(ArtistSummaryQuerySchema.parse(req.query)));

  // Server-proxied artist image — mirrors the existing video-thumbnail proxy
  // (GET /api/v1/libraryvideo/:id/thumbnail) so a connector's auth token
  // never has to reach the browser. Tries, in order: an explicit posterUrl
  // (a plain public IMVDb image URL, no credentials involved — but still
  // arbitrary and user-suppliable, so it goes through fetchImageSafely's
  // SSRF/size/content-type hardening, not a bare fetch), then a matched
  // Plex/Jellyfin LibraryArtist's own image.
  app.get<{ Params: { id: string } }>('/api/v1/artist/:id/image', async (req, reply) => {
    const id = Number(req.params.id);
    const artist = await prisma.artist.findUnique({ where: { id } });
    if (!artist) return reply.code(404).send({ error: 'Artist not found' });

    if (artist.posterUrl) {
      const image = await fetchImageSafely(artist.posterUrl);
      if (image) {
        return reply
          .header('Content-Type', image.contentType)
          .header('Cache-Control', 'private, max-age=3600')
          .send(image.data);
      }
    }

    const match = await prisma.libraryArtist.findFirst({
      where: { normalizedName: normalizeTitle(artist.name), connector: { enabled: true } },
      include: { connector: true },
    });
    const provider = match ? getLibraryConnectorProvider(match.connector.type) : null;
    if (!match || !provider?.fetchArtistImage) {
      return reply.code(404).send({ error: 'No image available' });
    }

    const image = await provider.fetchArtistImage(match.connector, match.externalId);
    if (!image) return reply.code(404).send({ error: 'No image available' });
    return reply
      .header('Content-Type', image.contentType)
      .header('Cache-Control', 'private, max-age=3600')
      .send(image.data);
  });

  // Bulk monitor/unmonitor from the Library page's multi-select. Applies one
  // at a time and reports per-id success/failure rather than failing the
  // whole batch on one bad id — a stale id in the selection (removed by
  // someone else mid-selection) shouldn't block updating the rest.
  app.post('/api/v1/artist/bulk-monitor', async (req) => {
    const body = BulkMonitorArtistsBodySchema.parse(req.body);
    // One commit for the selected flags. Stale IDs still have per-ID outcomes;
    // no artist catalog/provider request belongs on this acknowledgment path.
    try {
      return await prisma.$transaction(async tx => {
        const existing = new Set<number>();
        const unique = [...new Set(body.ids)];
        for (let offset = 0; offset < unique.length; offset += 400) {
          const ids = unique.slice(offset, offset + 400);
          for (const row of await tx.artist.findMany({ where: { id: { in: ids } }, select: { id: true } })) existing.add(row.id);
          await tx.artist.updateMany({ where: { id: { in: ids } }, data: { monitored: body.monitored } });
        }
        return { succeeded: body.ids.filter(id => existing.has(id)),
          failed: body.ids.filter(id => !existing.has(id)).map(id => ({ id, error: 'Artist not found' })) };
      }, { maxWait: 10_000, timeout: 30_000 });
    } catch (err) {
      app.log.warn({ err }, 'Bulk artist monitoring rolled back');
      return { succeeded: [], failed: body.ids.map(id => ({ id, error: 'Could not save monitoring changes; no artists were changed.' })) };
    }
  });

  app.post('/api/v1/artist/bulk-musicbrainz-discover', async (req) => {
    const body = BulkArtistIdsBodySchema.parse(req.body);
    const succeeded: Array<{ id: number; candidateCount: number }> = [];
    const failed: Array<{ id: number; error: string }> = [];
    for (const id of body.ids) {
      try {
        const candidates = await discoverArtistIdentityCandidates(id);
        succeeded.push({ id, candidateCount: candidates.length });
      } catch (error) {
        failed.push({ id, error: (error as Error).message });
      }
    }
    return { succeeded, failed };
  });

  app.post('/api/v1/artist/bulk-search-missing', async (req) => {
    const body = BulkArtistIdsBodySchema.parse(req.body);
    const videos = await prisma.musicVideo.findMany({
      where: {
        artistId: { in: body.ids },
        monitored: true,
        ignored: false,
        hasFile: false,
        awaitingServerScanAt: null,
        artist: { monitored: true },
        libraryVideos: { none: { available: true, matchConfidence: null, connector: { enabled: true } } },
        queueItems: { none: { status: { in: [...ACTIVE_DOWNLOAD_STATUSES] } } },
      },
      select: { id: true },
    });
    let grabbed = 0;
    let skipped = 0;
    for (const video of videos) {
      const outcome = await autoSearchAndGrab(video.id);
      if (outcome.grabbed) grabbed++;
      else skipped++;
    }
    return { grabbed, skipped };
  });

  app.get('/api/v1/artist/search-all-missing/preview', async () => previewBacklogSearch());
  app.post('/api/v1/artist/search-all-missing', async () => runBacklogSearch());
  app.post('/api/v1/artist/search-all-missing/confirmed', async (req) => {
    const { videoIds } = z.object({ videoIds: z.array(z.number().int().positive()).max(100000) }).strict().parse(req.body);
    return runBacklogSearch(videoIds);
  });

  // Lightweight payload for the Library-page accordion. Keep artwork,
  // acquisition-source history, and unmatched inventory on the full detail
  // endpoint so expanding rows remains cheap for large catalogs.
  app.get('/api/v1/artist/:id/videos', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const artist = await prisma.artist.findUnique({
      where: { id },
      select: {
        monitored: true,
        musicVideos: {
          where: { catalogKind: { not: 'liveClassified' } },
          orderBy: [{ releaseYear: { sort: 'asc', nulls: 'last' } }, { title: 'asc' }],
          select: {
            id: true,
            title: true,
            releaseYear: true,
            director: true,
            durationSeconds: true,
            monitored: true,
            ignored: true,
            hasFile: true,
            awaitingServerScanAt: true,
            file: { select: { playCount: true } },
            libraryVideos: {
              where: { available: true, connector: { enabled: true } },
              select: { available: true, matchConfidence: true, playCount: true },
            },
            queueItems: { select: { status: true, progress: true }, orderBy: { addedAt: 'desc' } },
          },
        },
      },
    });
    if (!artist) return reply.code(404).send({ error: 'Artist not found' });

    return artist.musicVideos.map((video) => ({
      ...video,
      effectivePlayCount: effectivePlayCount(video.file, video.libraryVideos),
      status: computeVideoStatus({
        hasFile: video.hasFile,
        monitored: video.monitored,
        ignored: video.ignored,
        artistMonitored: artist.monitored,
        libraryVideos: video.libraryVideos,
        queueItems: video.queueItems,
        awaitingServerScanAt: video.awaitingServerScanAt,
      }),
    }));
  });

  // Each video's `libraryVideos` carries only what the Artist Detail page's
  // "available on your media server" display needs (id for the thumbnail
  // proxy, playCount, connector name/type) — never the connector's raw
  // credentials, and filtered to `available: true` so a stale sync result
  // (removed from the server since the last sync) doesn't show as owned.
  // Also requires `matchConfidence: null` (an exact-key match, or a fuzzy
  // one a human has since confirmed via the Library Connectors "Needs
  // review" UI) — an unconfirmed probable/ambiguous fuzzy suggestion is not
  // a confirmed ownership fact, and this page has no confidence-badge
  // treatment for it, so showing it here would misrepresent it as owned.
  // `connector: { enabled: true }` keeps a disabled connector's stale
  // last-synced rows from counting as owned either.
  app.get('/api/v1/artist/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const artist = await prisma.artist.findUnique({
      where: { id },
      include: {
        musicVideos: {
          where: { catalogKind: { not: 'liveClassified' } },
          orderBy: { releaseYear: { sort: 'asc', nulls: 'last' } },
          include: {
            libraryVideos: {
              where: { available: true, connector: { enabled: true } },
              select: {
                id: true,
                available: true,
                matchConfidence: true,
                hasThumbnail: true,
                playCount: true,
                durationSeconds: true,
                connector: { select: { name: true, type: true } },
              },
            },
            queueItems: { select: { status: true, progress: true }, orderBy: { addedAt: 'desc' } },
            acquisitionSources: { orderBy: { id: 'asc' } },
            file: { select: { playCount: true } },
          },
        },
      },
    });
    if (!artist) return reply.code(404).send({ error: 'Artist not found' });

    const unmatchedInventory = await prisma.libraryVideo.findMany({
      where: {
        available: true,
        connector: { enabled: true },
        normalizedArtistName: normalizeTitle(artist.name),
        OR: [{ musicVideoId: null }, { matchConfidence: { not: null } }],
      },
      select: {
        id: true,
        title: true,
        releaseYear: true,
        durationSeconds: true,
        matchConfidence: true,
        musicVideoId: true,
        connector: { select: { name: true, type: true } },
      },
      orderBy: [{ releaseYear: { sort: 'asc', nulls: 'last' } }, { title: 'asc' }],
    });

    return {
      ...artist,
      musicVideos: artist.musicVideos.map((mv) => ({
        ...mv,
        effectivePlayCount: effectivePlayCount(mv.file, mv.libraryVideos),
        status: computeVideoStatus({
          hasFile: mv.hasFile,
          monitored: mv.monitored,
          ignored: mv.ignored,
          artistMonitored: artist.monitored,
          libraryVideos: mv.libraryVideos,
          queueItems: mv.queueItems,
          awaitingServerScanAt: mv.awaitingServerScanAt,
        }),
      })),
      summary: {
        known: artist.musicVideos.length,
        available: artist.musicVideos.filter((mv) => mv.hasFile || mv.libraryVideos.some((lv) => lv.available && lv.matchConfidence == null)).length,
        missing: artist.musicVideos.filter((mv) => !mv.hasFile && !mv.libraryVideos.some((lv) => lv.available && lv.matchConfidence == null)).length,
        monitored: artist.musicVideos.filter((mv) => mv.monitored).length,
        aggregatePlayCount: (() => {
          const counts = artist.musicVideos.flatMap((mv) => {
            const count = effectivePlayCount(mv.file, mv.libraryVideos);
            return count == null ? [] : [count];
          });
          return counts.length ? counts.reduce((sum, value) => sum + value, 0) : null;
        })(),
      },
      unmatchedInventory,
    };
  });

  app.post('/api/v1/artist/:id/refresh-metadata', async (req) => {
    const id = Number((req.params as { id: string }).id);
    return refreshArtistMetadata(id);
  });

  app.post('/api/v1/artist/:id/reconcile', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const artist = await prisma.artist.findUniqueOrThrow({
      where: { id },
      include: { musicVideos: true },
    });
    const candidates: CanonicalVideo[] = artist.musicVideos.map((video) => ({
      id: video.id,
      normalizedTitle: video.normalizedTitle,
      normalizedArtistName: normalizeTitle(artist.name),
      releaseYear: video.releaseYear,
      durationSeconds: video.durationSeconds,
    }));
    const inventory = await prisma.libraryVideo.findMany({
      where: { normalizedArtistName: normalizeTitle(artist.name), connector: { enabled: true } },
    });
    let confident = 0;
    let review = 0;
    let unmatched = 0;
    for (const item of inventory) {
      const match = matchLibraryVideo(
        {
          normalizedArtistName: item.normalizedArtistName,
          normalizedTitle: item.normalizedTitle,
          releaseYear: item.releaseYear,
          durationSeconds: item.durationSeconds,
        },
        candidates,
        { musicVideoId: item.musicVideoId, matchConfidence: item.matchConfidence as 'probable' | 'ambiguous' | null },
        item.rejectedMusicVideoId,
      );
      await prisma.libraryVideo.update({
        where: { id: item.id },
        data: { musicVideoId: match.musicVideoId, matchConfidence: match.matchConfidence },
      });
      if (!match.musicVideoId) unmatched++;
      else if (match.matchConfidence) review++;
      else confident++;
    }
    await prisma.artist.update({ where: { id }, data: { reconciledAt: new Date() } });
    return { confident, review, unmatched };
  });

  app.post('/api/v1/artist/:id/monitor-videos', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const body = req.body as { mode: 'all' | 'none' | 'missing' };
    const where: Prisma.MusicVideoWhereInput = { artistId: id };
    if (body.mode === 'missing') {
      where.hasFile = false;
      where.libraryVideos = { none: { available: true, matchConfidence: null, connector: { enabled: true } } };
    }
    const result = await prisma.musicVideo.updateMany({
      where,
      data: { monitored: body.mode !== 'none' },
    });
    return { updated: result.count };
  });

  app.post('/api/v1/artist/:id/search-missing', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const videos = await prisma.musicVideo.findMany({
      where: {
        artistId: id,
        monitored: true,
        ignored: false,
        hasFile: false,
        awaitingServerScanAt: null,
        artist: { monitored: true },
        libraryVideos: { none: { available: true, matchConfidence: null, connector: { enabled: true } } },
        queueItems: { none: { status: { in: [...ACTIVE_DOWNLOAD_STATUSES] } } },
      },
      select: { id: true },
    });
    let grabbed = 0;
    let skipped = 0;
    for (const video of videos) {
      const outcome = await autoSearchAndGrab(video.id);
      if (outcome.grabbed) grabbed++;
      else skipped++;
    }
    return { grabbed, skipped };
  });

  app.post('/api/v1/artist', async (req, reply) => {
    const body = CreateArtistSchema.parse(req.body);
    const created = await prisma.artist.create({
      data: {
        name: body.name,
        sortName: sortNameFor(body.name),
        imvdbArtistId: body.imvdbArtistId ?? null,
        monitored: body.monitored,
        rootFolderId: body.rootFolderId,
        qualityProfileId: body.qualityProfileId,
        posterUrl: body.posterUrl ?? null,
        genre: body.genre ?? null,
      },
    });
    await prisma.artistSource.create({
      data: {
        artistId: created.id,
        provider: body.imvdbArtistId ? 'imvdb' : 'manual',
        externalId: body.imvdbArtistId ?? null,
        origin: 'manual-add',
      },
    });
    reply.code(201);
    return created;
  });

  app.put('/api/v1/artist/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const body = UpdateArtistSchema.parse(req.body);
    const data: Record<string, unknown> = { ...body };
    if (body.name) data.sortName = sortNameFor(body.name);

    const before = await prisma.artist.findUniqueOrThrow({ where: { id } });
    let updated = await prisma.artist.update({ where: { id }, data });

    // A genre typed through this older field is the user's own value: record it as
    // explicit genres so a later MusicBrainz/Last.fm refresh cannot replace it.
    // null/empty hands control back to the automatic sources.
    if ('genre' in body) {
      await setUserGenres(id, parseGenreList(body.genre));
      updated = await prisma.artist.findUniqueOrThrow({ where: { id } });
    }

    // Save the action promptly; the existing durable source flow performs the
    // provider checks and exposes completion/failure through artist progress.
    let videosAdded: number | undefined;
    let metadataRefreshError: string | undefined;
    let sourceCollectionQueued: boolean | undefined;
    if (body.monitored === true && !before.monitored && updated.imvdbArtistId) {
      try {
        const status = await queueArtistVideoInventory(id);
        sourceCollectionQueued = true;
        updated = { ...updated, videoInventoryStatus: status };
      } catch (err) {
        metadataRefreshError = (err as Error).message;
        await logActivity('warn', 'metadata-refresh:manual', err);
      }
    }

    return { ...updated, videosAdded, metadataRefreshError, sourceCollectionQueued };
  });

  app.delete('/api/v1/artist/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (await prisma.livePerformance.count({ where: { artistId: id } }) || await prisma.liveCredit.count({ where: { artistId: id } })) {
      return reply.code(409).send({ error: 'Artist has live performances; preserve or reassign them before removing the artist' });
    }
    const deleted = await prisma.$transaction(async tx => {
      // Reserve the writer before checking, so a concurrent grab cannot slip
      // between eligibility and cascading deletion.
      await tx.artist.updateMany({ where: { id }, data: { id } });
      if (await tx.downloadQueueItem.count({ where: { status: { in: [...ACTIVE_DOWNLOAD_STATUSES] }, musicVideo: { artistId: id } } })) return false;
      await tx.artist.delete({ where: { id } });
      return true;
    });
    if (!deleted) return reply.code(409).send({ error: 'Artist has active downloads; finish or reconcile them before removing the artist' });
    reply.code(204);
  });

  // "Standard" genre match — looks up a controlled-vocabulary genre from an
  // enabled recommendation provider (currently only Spotify has real genre
  // data) and stamps it onto the artist. Always overwrites: this is an
  // explicit user action ("re-match"), not a background best-effort fill.
  app.post('/api/v1/artist/:id/match-genre', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const artist = await prisma.artist.findUniqueOrThrow({ where: { id } });
    const match = await matchStandardGenre(artist.name);
    if (!match) {
      return reply.code(404).send({ error: 'No standard genre match found — enable Spotify in Settings.' });
    }
    // An explicit user action, so it becomes the user's genres (replacing earlier
    // ones) rather than a background candidate.
    await setUserGenres(id, [match.genre]);
    return match;
  });
}
