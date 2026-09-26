import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import {
  CreateArtistSchema,
  UpdateArtistSchema,
  ArtistSummaryQuerySchema,
  BulkMonitorArtistsBodySchema,
  BulkArtistIdsBodySchema,
} from '@vidarr/shared-types';
import { prisma, logActivity } from '../db/client.js';
import { sortNameFor, normalizeTitle } from '../pipeline/normalize.js';
import { refreshArtistMetadata } from '../pipeline/metadataRefresh.js';
import { matchStandardGenre } from '../pipeline/genreMatch.js';
import { getLibraryConnectorProvider } from '../providers/library/index.js';
import { fetchImageSafely } from '../pipeline/safeImageFetch.js';
import { computeVideoStatus } from '../pipeline/videoStatus.js';
import { matchLibraryVideo, type CanonicalVideo } from '../pipeline/reconciliation.js';
import { autoSearchAndGrab, runBacklogSearch } from '../pipeline/autoSearch.js';
import { confirmArtistIdentity, discoverArtistIdentityCandidates } from '../pipeline/artistIdentity.js';

// Escapes SQLite LIKE's own wildcards so a search term containing "%" or "_"
// is matched literally rather than as a pattern.
function escapeLikeTerm(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

interface ArtistSummaryRow {
  id: number;
  name: string;
  sortName: string;
  genre: string | null;
  monitored: number;
  musicbrainzMatchStatus: string;
  musicbrainzMatchConfidence: number | null;
  musicbrainzCandidateId: string | null;
  musicbrainzCandidateName: string | null;
  musicbrainzCandidateScore: number | null;
  posterUrl: string | null;
  knownVideoCount: number;
  availableVideoCount: number;
  missingVideoCount: number;
  downloadingVideoCount: number;
  monitoredVideoCount: number;
  unmatchedVideoCount: number;
  supplementaryVideoCount: number;
  aggregatePlayCount: number | null;
  letter: string;
}

export async function artistRoutes(app: FastifyInstance) {
  app.get('/api/v1/artist', async () => {
    return prisma.artist.findMany({ orderBy: { sortName: 'asc' } });
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
    if (!await prisma.artist.findUnique({ where: { id }, select: { id: true } })) {
      return reply.code(404).send({ error: 'Artist not found' });
    }
    return discoverArtistIdentityCandidates(id);
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
    return confirmArtistIdentity(id, musicbrainzArtistId.toLowerCase());
  });

  // Powers the Library page's artist-centered list — combines the counts a
  // row needs (known/available/missing/downloading, aggregate play count)
  // with search/genre/monitored/letter/count filters and pagination.
  // Deliberately separate from `GET /api/v1/artist` above (PlaylistsPage's
  // artist picker still wants the plain, unfiltered list) rather than
  // changing that route's shape.
  //
  // Runs as raw SQL rather than Prisma's fluent API: search/genre/monitored
  // filter Artist rows in SQL, per-video availability/downloading/play-count
  // facts are aggregated per artist via GROUP BY (never materialized as JS
  // objects), and minKnownVideos/minPlayCount/hasMissing/letter filter those
  // aggregates before LIMIT/OFFSET paginates — so a request only ever pulls
  // one page of ARTIST rows into Node, regardless of catalog size. The one
  // accepted tradeoff: the CTE chain below recomputes per-video aggregates
  // across the whole MusicVideo table on each of the three queries (page,
  // total, availableLetters) rather than a single shared temp table — still
  // entirely inside SQLite over indexed FKs, and vastly cheaper than the
  // previous approach of loading every artist's full video/file/queue graph
  // into JS on every request.
  //
  // A video counts as "available" if it has a local file OR is matched
  // (`LibraryVideo.musicVideoId`) to a still-`available` row synced from an
  // enabled Plex/Jellyfin connector — see libraryconnector.ts's sync route
  // for how that match is written. `matchConfidence IS NULL` requires the
  // match to be an exact-key hit (or a fuzzy one a human has since
  // confirmed) — a probable/ambiguous fuzzy suggestion is not yet a
  // confirmed ownership fact, so it must not count here (a wrong suggestion
  // would otherwise mark a genuinely missing video as present and suppress
  // it from auto-search with no visible signal). `lc.enabled = 1` keeps a
  // disabled connector's stale last-synced rows from counting at all. Play
  // count prefers the locally-synced MusicVideoFile.playCount (kept current
  // by pipeline/playCountSync.ts) and falls back to a matched LibraryVideo's
  // playCount when there's no local file at all — never summed across both,
  // and left `null` (not 0) when neither source has any play-count data for
  // that artist's videos.
  app.get('/api/v1/artist/summary', async (req) => {
    const query = ArtistSummaryQuerySchema.parse(req.query);

    const baseConditions: Prisma.Sql[] = [Prisma.sql`1=1`];
    if (query.search) {
      baseConditions.push(Prisma.sql`a."name" LIKE ${'%' + escapeLikeTerm(query.search) + '%'} ESCAPE '\\'`);
    }
    if (query.genre === '__unknown__') {
      baseConditions.push(Prisma.sql`(a."genre" IS NULL OR TRIM(a."genre") = '')`);
    } else if (query.genre) {
      baseConditions.push(Prisma.sql`(',' || LOWER(REPLACE(a."genre", ', ', ',')) || ',') LIKE ${'%,' + query.genre.toLowerCase() + ',%'}`);
    }
    if (query.monitored) baseConditions.push(Prisma.sql`a."monitored" = ${query.monitored === 'true' ? 1 : 0}`);
    if (query.musicbrainzStatus) baseConditions.push(Prisma.sql`a."musicbrainzMatchStatus" = ${query.musicbrainzStatus}`);
    const baseWhere = Prisma.join(baseConditions, ' AND ');

    const refineConditions: Prisma.Sql[] = [Prisma.sql`1=1`];
    if (query.letter) refineConditions.push(Prisma.sql`"letter" = ${query.letter.toUpperCase()}`);
    if (query.minKnownVideos != null) {
      refineConditions.push(Prisma.sql`"knownVideoCount" >= ${query.minKnownVideos}`);
    }
    if (query.minPlayCount != null) {
      refineConditions.push(Prisma.sql`COALESCE("aggregatePlayCount", 0) >= ${query.minPlayCount}`);
    }
    if (query.hasMissing === 'true') refineConditions.push(Prisma.sql`"missingVideoCount" > 0`);
    if (query.completeness === 'complete') refineConditions.push(Prisma.sql`"missingVideoCount" = 0 AND "knownVideoCount" > 0`);
    if (query.completeness === 'unmatched') refineConditions.push(Prisma.sql`"unmatchedVideoCount" > 0`);
    if (query.completeness === 'activeDownloads') refineConditions.push(Prisma.sql`"downloadingVideoCount" > 0`);
    const refineWhere = Prisma.join(refineConditions, ' AND ');

    const filteredCte = Prisma.sql`
      WITH video_stats AS (
        SELECT
          mv."artistId" AS "artistId",
          mv."monitored" AS "isMonitored",
          CASE WHEN mv."hasFile" = 1 OR EXISTS (
            SELECT 1 FROM "LibraryVideo" lv
            JOIN "LibraryConnector" lc ON lc."id" = lv."connectorId"
            WHERE lv."musicVideoId" = mv."id" AND lv."available" = 1 AND lv."matchConfidence" IS NULL AND lc."enabled" = 1
          ) THEN 1 ELSE 0 END AS "isAvailable",
          CASE WHEN EXISTS (
            SELECT 1 FROM "DownloadQueueItem" q
            WHERE q."musicVideoId" = mv."id" AND q."status" IN ('queued', 'downloading', 'submissionUnknown', 'importing')
          ) THEN 1 ELSE 0 END AS "isDownloading",
          COALESCE(
            (SELECT f."playCount" FROM "MusicVideoFile" f WHERE f."musicVideoId" = mv."id"),
            (SELECT MAX(lv2."playCount") FROM "LibraryVideo" lv2
             JOIN "LibraryConnector" lc2 ON lc2."id" = lv2."connectorId"
             WHERE lv2."musicVideoId" = mv."id" AND lv2."available" = 1 AND lv2."matchConfidence" IS NULL AND lc2."enabled" = 1)
          ) AS "playCount"
        FROM "MusicVideo" mv
        WHERE mv."catalogKind" = 'official' AND mv."catalogStatus" = 'active'
      ),
      artist_stats AS (
        SELECT
          "artistId",
          COUNT(*) AS "known",
          SUM("isAvailable") AS "available",
          SUM("isDownloading") AS "downloading",
          SUM("isMonitored") AS "monitored",
          SUM(CASE WHEN "playCount" IS NOT NULL THEN "playCount" ELSE 0 END) AS "playCountSum",
          SUM(CASE WHEN "playCount" IS NOT NULL THEN 1 ELSE 0 END) AS "playCountKnownN"
        FROM video_stats
        GROUP BY "artistId"
      ),
      filtered AS (
        SELECT
          a."id" AS "id",
          a."name" AS "name",
          a."sortName" AS "sortName",
          a."genre" AS "genre",
          a."monitored" AS "monitored",
          a."musicbrainzMatchStatus" AS "musicbrainzMatchStatus",
          a."musicbrainzMatchConfidence" AS "musicbrainzMatchConfidence",
          (SELECT c."musicbrainzArtistId" FROM "MusicBrainzArtistCandidate" c WHERE c."artistId" = a."id" AND c."status" = 'suggested' ORDER BY c."score" DESC LIMIT 1) AS "musicbrainzCandidateId",
          (SELECT c."name" FROM "MusicBrainzArtistCandidate" c WHERE c."artistId" = a."id" AND c."status" = 'suggested' ORDER BY c."score" DESC LIMIT 1) AS "musicbrainzCandidateName",
          (SELECT c."score" FROM "MusicBrainzArtistCandidate" c WHERE c."artistId" = a."id" AND c."status" = 'suggested' ORDER BY c."score" DESC LIMIT 1) AS "musicbrainzCandidateScore",
          a."posterUrl" AS "posterUrl",
          COALESCE(s."known", 0) AS "knownVideoCount",
          COALESCE(s."available", 0) AS "availableVideoCount",
          COALESCE(s."known", 0) - COALESCE(s."available", 0) AS "missingVideoCount",
          COALESCE(s."downloading", 0) AS "downloadingVideoCount",
          COALESCE(s."monitored", 0) AS "monitoredVideoCount",
          (SELECT COUNT(*) FROM "LibraryVideo" ulv
             JOIN "LibraryConnector" ulc ON ulc."id" = ulv."connectorId"
             WHERE ulc."enabled" = 1 AND ulv."available" = 1
               AND ulv."normalizedArtistName" = LOWER(TRIM(a."name"))
               AND (ulv."musicVideoId" IS NULL OR ulv."matchConfidence" IS NOT NULL)
          ) AS "unmatchedVideoCount",
          (SELECT COUNT(*) FROM "MusicVideo" smv
             WHERE smv."artistId" = a."id" AND smv."catalogKind" IN ('supplementary', 'inventory')
          ) AS "supplementaryVideoCount",
          CASE WHEN COALESCE(s."playCountKnownN", 0) > 0 THEN s."playCountSum" ELSE NULL END AS "aggregatePlayCount",
          CASE
            WHEN UPPER(SUBSTR(TRIM(a."sortName"), 1, 1)) BETWEEN 'A' AND 'Z'
            THEN UPPER(SUBSTR(TRIM(a."sortName"), 1, 1))
            ELSE '#'
          END AS "letter"
        FROM "Artist" a
        LEFT JOIN artist_stats s ON s."artistId" = a."id"
        WHERE ${baseWhere}
      )
    `;

    const [page, totalRows, letterRows, imageableNames] = await Promise.all([
      prisma.$queryRaw<ArtistSummaryRow[]>(Prisma.sql`
        ${filteredCte}
        SELECT * FROM filtered WHERE ${refineWhere}
        ORDER BY "sortName" ASC
        LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}
      `),
      prisma.$queryRaw<{ total: number }[]>(Prisma.sql`
        ${filteredCte}
        SELECT COUNT(*) AS "total" FROM filtered WHERE ${refineWhere}
      `),
      // availableLetters reflects search/genre/monitored only (not the
      // count/letter/hasMissing refinements) — matches the rail's job of
      // showing every letter reachable from the *current* base filters.
      prisma.$queryRaw<{ letter: string }[]>(Prisma.sql`
        ${filteredCte}
        SELECT DISTINCT "letter" FROM filtered
      `),
      // Cheap existence hint for whether the image proxy has anything to try
      // — avoids every row firing a request that will just 404. A name match
      // against a connector whose provider doesn't implement fetchArtistImage
      // (Subsonic) is a rare, harmless over-estimate: the proxy route below
      // just 404s in that case, same as an artist with no image at all.
      prisma.libraryArtist.findMany({
        where: { connector: { enabled: true } },
        select: { normalizedName: true },
      }),
    ]);
    const imageableNameSet = new Set(imageableNames.map((a) => a.normalizedName));

    const items = page.map((row) => ({
      id: row.id,
      name: row.name,
      sortName: row.sortName,
      genre: row.genre,
      monitored: Boolean(row.monitored),
      musicbrainzMatchStatus: row.musicbrainzMatchStatus,
      musicbrainzMatchConfidence: row.musicbrainzMatchConfidence,
      musicbrainzCandidateId: row.musicbrainzCandidateId,
      musicbrainzCandidateName: row.musicbrainzCandidateName,
      musicbrainzCandidateScore: row.musicbrainzCandidateScore,
      hasImage: Boolean(row.posterUrl) || imageableNameSet.has(normalizeTitle(row.name)),
      knownVideoCount: Number(row.knownVideoCount),
      availableVideoCount: Number(row.availableVideoCount),
      missingVideoCount: Number(row.missingVideoCount),
      downloadingVideoCount: Number(row.downloadingVideoCount),
      monitoredVideoCount: Number(row.monitoredVideoCount),
      unmatchedVideoCount: Number(row.unmatchedVideoCount),
      supplementaryVideoCount: Number(row.supplementaryVideoCount),
      aggregatePlayCount: row.aggregatePlayCount == null ? null : Number(row.aggregatePlayCount),
    }));
    const availableLetters = letterRows.map((r) => r.letter).sort();

    return {
      items,
      total: Number(totalRows[0]?.total ?? 0),
      page: query.page,
      pageSize: query.pageSize,
      availableLetters,
    };
  });

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

    const unmatchedInventory = await prisma.libraryVideo.findMany({
      where: {
        available: true,
        normalizedArtistName: normalizeTitle(artist.name),
        connector: { enabled: true },
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
    });

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
    const succeeded: number[] = [];
    const failed: { id: number; error: string }[] = [];

    for (const id of body.ids) {
      try {
        await prisma.artist.update({ where: { id }, data: { monitored: body.monitored } });
        succeeded.push(id);
      } catch (err) {
        failed.push({ id, error: (err as Error).message });
      }
    }

    return { succeeded, failed };
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
        queueItems: { none: { status: { in: ['queued', 'downloading', 'submissionUnknown', 'importing'] } } },
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

  app.post('/api/v1/artist/search-all-missing', async () => runBacklogSearch());

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
          const counts = artist.musicVideos.flatMap((mv) => mv.libraryVideos.map((lv) => lv.playCount).filter((v): v is number => v != null));
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
        queueItems: { none: { status: { in: ['queued', 'downloading', 'submissionUnknown', 'importing'] } } },
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
    const updated = await prisma.artist.update({ where: { id }, data });

    // Turning monitoring on (re-)establishes the artist's full video list from
    // IMVDb immediately, rather than waiting for the next scheduled refresh.
    let videosAdded: number | undefined;
    let metadataRefreshError: string | undefined;
    if (body.monitored === true && !before.monitored && updated.imvdbArtistId) {
      try {
        videosAdded = (await refreshArtistMetadata(id)).videosAdded;
      } catch (err) {
        metadataRefreshError = (err as Error).message;
        await logActivity('warn', 'metadata-refresh:manual', err);
      }
    }

    return { ...updated, videosAdded, metadataRefreshError };
  });

  app.delete('/api/v1/artist/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    await prisma.artist.delete({ where: { id } });
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
    await prisma.artist.update({ where: { id }, data: { genre: match.genre } });
    return match;
  });
}
