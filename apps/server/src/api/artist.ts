import type { FastifyInstance } from 'fastify';
import {
  CreateArtistSchema,
  UpdateArtistSchema,
  ArtistSummaryQuerySchema,
  BulkMonitorArtistsBodySchema,
} from '@vidarr/shared-types';
import { prisma, logActivity } from '../db/client.js';
import { sortNameFor, normalizeTitle } from '../pipeline/normalize.js';
import { refreshArtistMetadata } from '../pipeline/metadataRefresh.js';
import { matchStandardGenre } from '../pipeline/genreMatch.js';
import { getLibraryConnectorProvider } from '../providers/library/index.js';

const ACTIVE_QUEUE_STATUSES = new Set(['queued', 'downloading', 'importing']);

// "#" for anything that doesn't start with a letter — keeps the A-Z rail's
// bucket count fixed at 27 regardless of what odd artist names show up.
function letterBucket(sortName: string): string {
  const first = sortName.trim().charAt(0).toUpperCase();
  return first >= 'A' && first <= 'Z' ? first : '#';
}

export async function artistRoutes(app: FastifyInstance) {
  app.get('/api/v1/artist', async () => {
    return prisma.artist.findMany({ orderBy: { sortName: 'asc' } });
  });

  // Powers the Library page's artist-centered list — combines the counts a
  // row needs (known/available/missing/downloading, aggregate play count)
  // with search/genre/monitored/letter/count filters and pagination, in one
  // query rather than one query per artist. Deliberately separate from
  // `GET /api/v1/artist` above (PlaylistsPage's artist picker still wants
  // the plain, unfiltered list) rather than changing that route's shape.
  //
  // Filtering/pagination happen in JS over one eagerly-loaded result set
  // rather than fully in SQL — correct and a single round trip, but not the
  // server-side-aggregated-at-the-database-level design a truly huge
  // library would eventually want; see the Phase 1 plan's "explicitly
  // deferred" section.
  app.get('/api/v1/artist/summary', async (req) => {
    const query = ArtistSummaryQuerySchema.parse(req.query);

    const where: NonNullable<Parameters<typeof prisma.artist.findMany>[0]>['where'] = {};
    if (query.search) where.name = { contains: query.search };
    if (query.genre) where.genre = query.genre;
    if (query.monitored) where.monitored = query.monitored === 'true';

    const [artists, imageableNames] = await Promise.all([
      prisma.artist.findMany({
        where,
        orderBy: { sortName: 'asc' },
        include: {
          musicVideos: {
            select: {
              hasFile: true,
              file: { select: { playCount: true } },
              queueItems: { select: { status: true } },
            },
          },
        },
      }),
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

    const allSummaries = artists.map((artist) => {
      const known = artist.musicVideos.length;
      const available = artist.musicVideos.filter((v) => v.hasFile).length;
      const downloading = artist.musicVideos.filter((v) =>
        v.queueItems.some((q) => ACTIVE_QUEUE_STATUSES.has(q.status)),
      ).length;
      const playCounts = artist.musicVideos
        .map((v) => v.file?.playCount)
        .filter((p): p is number => p != null);

      return {
        id: artist.id,
        name: artist.name,
        sortName: artist.sortName,
        genre: artist.genre,
        monitored: artist.monitored,
        hasImage: Boolean(artist.posterUrl) || imageableNameSet.has(normalizeTitle(artist.name)),
        knownVideoCount: known,
        availableVideoCount: available,
        missingVideoCount: known - available,
        downloadingVideoCount: downloading,
        aggregatePlayCount: playCounts.length ? playCounts.reduce((a, b) => a + b, 0) : null,
        letter: letterBucket(artist.sortName),
      };
    });

    const availableLetters = [...new Set(allSummaries.map((s) => s.letter))].sort();

    let filtered = allSummaries;
    if (query.letter) filtered = filtered.filter((s) => s.letter === query.letter!.toUpperCase());
    if (query.minKnownVideos != null) {
      filtered = filtered.filter((s) => s.knownVideoCount >= query.minKnownVideos!);
    }
    if (query.minPlayCount != null) {
      filtered = filtered.filter((s) => (s.aggregatePlayCount ?? 0) >= query.minPlayCount!);
    }
    if (query.hasMissing === 'true') filtered = filtered.filter((s) => s.missingVideoCount > 0);

    const total = filtered.length;
    const start = (query.page - 1) * query.pageSize;
    const items = filtered.slice(start, start + query.pageSize).map(({ letter: _letter, ...rest }) => rest);

    return { items, total, page: query.page, pageSize: query.pageSize, availableLetters };
  });

  // Server-proxied artist image — mirrors the existing video-thumbnail proxy
  // (GET /api/v1/libraryvideo/:id/thumbnail) so a connector's auth token
  // never has to reach the browser. Tries, in order: an explicit posterUrl
  // (a plain public IMVDb image URL, no credentials involved), then a
  // matched Plex/Jellyfin LibraryArtist's own image.
  app.get<{ Params: { id: string } }>('/api/v1/artist/:id/image', async (req, reply) => {
    const id = Number(req.params.id);
    const artist = await prisma.artist.findUnique({ where: { id } });
    if (!artist) return reply.code(404).send({ error: 'Artist not found' });

    if (artist.posterUrl) {
      try {
        const res = await fetch(artist.posterUrl);
        if (res.ok) {
          return reply
            .header('Content-Type', res.headers.get('content-type') ?? 'image/jpeg')
            .header('Cache-Control', 'private, max-age=3600')
            .send(Buffer.from(await res.arrayBuffer()));
        }
      } catch {
        // fall through to the connector-matched image
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

  app.get('/api/v1/artist/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const artist = await prisma.artist.findUnique({
      where: { id },
      include: {
        musicVideos: { orderBy: { releaseYear: { sort: 'asc', nulls: 'last' } } },
      },
    });
    if (!artist) return reply.code(404).send({ error: 'Artist not found' });
    return artist;
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
