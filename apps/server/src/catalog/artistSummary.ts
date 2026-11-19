import { effectivePlayCountSql } from './playCounts.js';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { ArtistSummaryQuerySchema } from '@vidarr/shared-types';
import { prisma, readPrisma } from '../db/client.js';
import { ACTIVE_DOWNLOAD_STATUSES } from '../media/lifecycle.js';
import { normalizeTitle } from '../pipeline/normalize.js';
import { genreArtistIds } from '../pipeline/artistGenres.js';
import { escapeLikeTerm } from '../db/sqlPatterns.js';

interface ArtistSummaryRow {
  id: number;
  addedAt: Date;
  videoInventoryStatus: string;
  videoInventoryError: string | null;
  pendingVideoReviewCount: number;
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
  localVideoCount: number;
  availableVideoCount: number;
  missingVideoCount: number;
  downloadingVideoCount: number;
  monitoredVideoCount: number;
  unmatchedVideoCount: number;
  supplementaryVideoCount: number;
  inventoryVideoCount: number;
  aggregatePlayCount: number | null;
  letter: string;
}
type ArtistSummaryMetadata = { total: number | bigint; availableLetters: string };
type ArtistSummaryResult = Omit<ArtistSummaryRow, 'id'> & ArtistSummaryMetadata & { id: number | null };

export async function getArtistSummary(query: z.infer<typeof ArtistSummaryQuerySchema>) {

  // Observations remain visible for navigation/review without becoming confirmed identities.
  // Linked observations are represented by their canonical owner instead of duplicate rows.
  const baseConditions: Prisma.Sql[] = [Prisma.sql`a."musicbrainzMatchStatus" <> 'linked'`];
  if (query.search) {
    baseConditions.push(Prisma.sql`a."name" LIKE ${'%' + escapeLikeTerm(query.search) + '%'} ESCAPE '\\'`);
  }
  if (query.genre) {
    const genreIds = await genreArtistIds(query.genre);
    // One bound JSON value avoids SQLite's parameter limit in large genres.
    baseConditions.push(Prisma.sql`a."id" IN (SELECT CAST(value AS INTEGER) FROM json_each(${JSON.stringify(genreIds)}))`);
  }
  if (query.monitored) baseConditions.push(Prisma.sql`a."monitored" = ${query.monitored === 'true' ? 1 : 0}`);
  if (query.musicbrainzStatus) baseConditions.push(Prisma.sql`a."musicbrainzMatchStatus" = ${query.musicbrainzStatus}`);
  const baseWhere = Prisma.join(baseConditions, ' AND ');

  const names = await readPrisma.$queryRaw<Array<{ id: number; name: string }>>(Prisma.sql`SELECT a."id", a."name" FROM "Artist" a WHERE ${baseWhere}`);
  const identityKeys = JSON.stringify(Object.fromEntries(names.map(artist => [artist.id, normalizeTitle(artist.name)])));

  const refineConditions: Prisma.Sql[] = [Prisma.sql`1=1`];
  const videoPresence = Prisma.sql`("availableVideoCount" > 0 OR "knownVideoCount" > 0 OR "unmatchedVideoCount" > 0)`;
  if (query.hideWithoutVideos === 'true') refineConditions.push(videoPresence);
  if (query.letter) refineConditions.push(Prisma.sql`"letter" = ${query.letter.toUpperCase()}`);
  if (query.minKnownVideos != null) {
    refineConditions.push(Prisma.sql`"knownVideoCount" >= ${query.minKnownVideos}`);
  }
  if (query.minLocalVideos != null) {
    refineConditions.push(Prisma.sql`"localVideoCount" >= ${query.minLocalVideos}`);
  }
  if (query.minPlayCount != null) {
    refineConditions.push(Prisma.sql`COALESCE("aggregatePlayCount", 0) >= ${query.minPlayCount}`);
  }
  if (query.hasMissing === 'true') refineConditions.push(Prisma.sql`"missingVideoCount" > 0`);
  if (query.completeness === 'complete') refineConditions.push(Prisma.sql`"missingVideoCount" = 0 AND "knownVideoCount" > 0`);
  if (query.completeness === 'unmatched') refineConditions.push(Prisma.sql`"unmatchedVideoCount" > 0`);
  if (query.completeness === 'activeDownloads') refineConditions.push(Prisma.sql`"downloadingVideoCount" > 0`);
  const refineWhere = Prisma.join(refineConditions, ' AND ');

  // Library navigation follows the name on the row, not MusicBrainz's hidden
  // surname-first sort name. Keep the established leading-article convention.
  const librarySortName = Prisma.sql`TRIM(CASE
    WHEN LOWER(SUBSTR(TRIM(a."name"), 1, 4)) = 'the ' THEN SUBSTR(TRIM(a."name"), 5)
    WHEN LOWER(SUBSTR(TRIM(a."name"), 1, 3)) = 'an ' THEN SUBSTR(TRIM(a."name"), 4)
    WHEN LOWER(SUBSTR(TRIM(a."name"), 1, 2)) = 'a ' THEN SUBSTR(TRIM(a."name"), 3)
    ELSE a."name" END)`;

  const filteredCte = Prisma.sql`
    WITH base_artists AS MATERIALIZED (
      SELECT a."id", a."addedAt", a."videoInventoryStatus", a."videoInventoryError",
        a."name", a."sortName", a."genre", a."monitored", a."musicbrainzMatchStatus",
        a."musicbrainzMatchConfidence", a."posterUrl", identity.value AS "normalizedArtistName",
        CASE WHEN UPPER(SUBSTR(${librarySortName}, 1, 1)) BETWEEN 'A' AND 'Z'
          THEN UPPER(SUBSTR(${librarySortName}, 1, 1)) ELSE '#' END AS "letter"
      FROM "Artist" a JOIN json_each(${identityKeys}) identity ON CAST(identity.key AS INTEGER) = a."id" WHERE ${baseWhere}
    ),
    selected_artists AS MATERIALIZED (
      SELECT * FROM base_artists WHERE ${query.letter ? Prisma.sql`"letter" = ${query.letter.toUpperCase()}` : Prisma.sql`1=1`}
    ),
    library_stats AS (
      SELECT lv."musicVideoId", MAX(lv."playCount") AS "playCount"
      FROM "LibraryVideo" lv
      JOIN "LibraryConnector" lc ON lc."id" = lv."connectorId"
      WHERE lv."musicVideoId" IS NOT NULL AND lv."available" = 1
        AND lv."matchConfidence" IS NULL AND lc."enabled" = 1
        AND lv."musicVideoId" IN (
          SELECT mv."id" FROM "MusicVideo" mv JOIN selected_artists a ON a."id" = mv."artistId"
        )
      GROUP BY lv."musicVideoId"
    ),
    queue_stats AS (
      SELECT DISTINCT "musicVideoId" FROM "DownloadQueueItem"
      WHERE "status" IN (${Prisma.join(ACTIVE_DOWNLOAD_STATUSES)})
    ),
    video_stats AS (
      SELECT
        mv."artistId" AS "artistId",
        mv."catalogKind" AS "catalogKind",
        mv."monitored" AS "isMonitored",
        CASE WHEN mv."hasFile" = 1 THEN 1 ELSE 0 END AS "isLocal",
        CASE WHEN mv."hasFile" = 1 OR ls."musicVideoId" IS NOT NULL THEN 1 ELSE 0 END AS "isAvailable",
        CASE WHEN qs."musicVideoId" IS NOT NULL THEN 1 ELSE 0 END AS "isDownloading",
        ${effectivePlayCountSql(Prisma.sql`f."playCount"`, Prisma.sql`ls."playCount"`)} AS "playCount"
      FROM "MusicVideo" mv
      JOIN selected_artists selected ON selected."id" = mv."artistId"
      LEFT JOIN library_stats ls ON ls."musicVideoId" = mv."id"
      LEFT JOIN queue_stats qs ON qs."musicVideoId" = mv."id"
      LEFT JOIN "MusicVideoFile" f ON f."musicVideoId" = mv."id"
      WHERE mv."catalogKind" <> 'liveClassified'
      -- Library counts describe the same preserved inventory as expanded rows.
      -- Catalog review status does not erase ownership or missing-video facts.
    ),
    artist_stats AS (
      SELECT
        "artistId",
        COUNT(*) AS "known",
        SUM(CASE WHEN "catalogKind" = 'supplementary' THEN 1 ELSE 0 END) AS "supplementary",
        SUM(CASE WHEN "catalogKind" = 'inventory' THEN 1 ELSE 0 END) AS "inventory",
        SUM("isLocal") AS "local",
        SUM("isAvailable") AS "available",
        SUM("isDownloading") AS "downloading",
        SUM("isMonitored") AS "monitored",
        SUM(CASE WHEN "playCount" IS NOT NULL THEN "playCount" ELSE 0 END) AS "playCountSum",
        SUM(CASE WHEN "playCount" IS NOT NULL THEN 1 ELSE 0 END) AS "playCountKnownN"
      FROM video_stats
      GROUP BY "artistId"
    ),
    unmatched_stats AS (
      SELECT lv."normalizedArtistName", COUNT(*) AS "unmatched"
      FROM "LibraryVideo" lv JOIN "LibraryConnector" lc ON lc."id" = lv."connectorId"
      WHERE lc."enabled" = 1 AND lv."available" = 1
        AND (lv."musicVideoId" IS NULL OR lv."matchConfidence" IS NOT NULL)
        AND lv."normalizedArtistName" IN (SELECT "normalizedArtistName" FROM selected_artists)
      GROUP BY lv."normalizedArtistName"
    ),
    filtered AS MATERIALIZED (
      SELECT
        a."id" AS "id",
        a."addedAt" AS "addedAt",
        a."videoInventoryStatus" AS "videoInventoryStatus",
        a."videoInventoryError" AS "videoInventoryError",
        a."name" AS "name",
        a."sortName" AS "sortName",
        ${librarySortName} AS "librarySortName",
        a."genre" AS "genre",
        a."monitored" AS "monitored",
        a."musicbrainzMatchStatus" AS "musicbrainzMatchStatus",
        a."musicbrainzMatchConfidence" AS "musicbrainzMatchConfidence",
        a."posterUrl" AS "posterUrl",
        COALESCE(s."known", 0) AS "knownVideoCount",
        COALESCE(s."local", 0) AS "localVideoCount",
        COALESCE(s."available", 0) AS "availableVideoCount",
        COALESCE(s."known", 0) - COALESCE(s."available", 0) AS "missingVideoCount",
        COALESCE(s."downloading", 0) AS "downloadingVideoCount",
        COALESCE(s."monitored", 0) AS "monitoredVideoCount",
        COALESCE(u."unmatched", 0) AS "unmatchedVideoCount",
        COALESCE(s."supplementary", 0) AS "supplementaryVideoCount",
        COALESCE(s."inventory", 0) AS "inventoryVideoCount",
        CASE WHEN COALESCE(s."playCountKnownN", 0) > 0 THEN s."playCountSum" ELSE NULL END AS "aggregatePlayCount",
        a."letter" AS "letter"
      FROM selected_artists a
      LEFT JOIN artist_stats s ON s."artistId" = a."id"
      LEFT JOIN unmatched_stats u ON u."normalizedArtistName" = a."normalizedArtistName"
    )
  `;

  const rows = await readPrisma.$queryRaw<ArtistSummaryResult[]>(Prisma.sql`
      ${filteredCte}
      SELECT page.*,
        (SELECT COUNT(*) FROM "VideoReviewCandidate" vrc WHERE vrc."artistId" = page."id" AND vrc."decision" = 'pending') AS "pendingVideoReviewCount",
        (SELECT c."musicbrainzArtistId" FROM "MusicBrainzArtistCandidate" c WHERE c."artistId" = page."id" AND c."status" = 'suggested' ORDER BY c."score" DESC LIMIT 1) AS "musicbrainzCandidateId",
        (SELECT c."name" FROM "MusicBrainzArtistCandidate" c WHERE c."artistId" = page."id" AND c."status" = 'suggested' ORDER BY c."score" DESC LIMIT 1) AS "musicbrainzCandidateName",
        (SELECT c."score" FROM "MusicBrainzArtistCandidate" c WHERE c."artistId" = page."id" AND c."status" = 'suggested' ORDER BY c."score" DESC LIMIT 1) AS "musicbrainzCandidateScore",
        totals."total", letters."availableLetters"
      FROM (SELECT COUNT(*) AS "total" FROM filtered WHERE ${refineWhere}) totals
      CROSS JOIN (
        SELECT json_group_array("letter") AS "availableLetters" FROM (
          SELECT DISTINCT a."letter" FROM base_artists a
          WHERE ${query.hideWithoutVideos === 'true' ? Prisma.sql`
            EXISTS (SELECT 1 FROM "MusicVideo" mv WHERE mv."artistId" = a."id" AND mv."catalogKind" <> 'liveClassified')
            OR EXISTS (
              SELECT 1 FROM "LibraryVideo" lv JOIN "LibraryConnector" lc ON lc."id" = lv."connectorId"
              WHERE lv."normalizedArtistName" = a."normalizedArtistName" AND lv."available" = 1 AND lc."enabled" = 1
                AND (lv."musicVideoId" IS NULL OR lv."matchConfidence" IS NOT NULL)
            )` : Prisma.sql`1=1`}
        )
      ) letters
      LEFT JOIN (
        SELECT * FROM filtered WHERE ${refineWhere}
        ORDER BY "librarySortName" COLLATE NOCASE ASC, "id" ASC
        LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}
      ) page ON 1=1
      ORDER BY page."librarySortName" COLLATE NOCASE ASC, page."id" ASC
    `);
  // The metadata side always yields one row, even for an empty/out-of-range
  // page. Never expose its null page placeholder as an artist.
  const page = rows.filter((row): row is ArtistSummaryRow & ArtistSummaryMetadata => row.id !== null);
  const imageableNames = page.length ? await prisma.libraryArtist.findMany({
    // Cheap existence hint for whether the image proxy has anything to try
    // — avoids every row firing a request that will just 404. A name match
    // against a connector whose provider doesn't implement fetchArtistImage
    // (Subsonic) is a rare, harmless over-estimate: the proxy route below
    // just 404s in that case, same as an artist with no image at all.
      where: { connector: { enabled: true }, normalizedName: { in: page.map(row => normalizeTitle(row.name)) } },
      select: { normalizedName: true },
    }) : [];
  const imageableNameSet = new Set(imageableNames.map((a) => a.normalizedName));

  const items = page.map((row) => ({
    id: row.id,
    addedAt: new Date(row.addedAt).toISOString(),
    videoInventoryStatus: row.videoInventoryStatus,
    videoInventoryError: row.videoInventoryError,
    pendingVideoReviewCount: Number(row.pendingVideoReviewCount),
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
    localVideoCount: Number(row.localVideoCount),
    availableVideoCount: Number(row.availableVideoCount),
    missingVideoCount: Number(row.missingVideoCount),
    downloadingVideoCount: Number(row.downloadingVideoCount),
    monitoredVideoCount: Number(row.monitoredVideoCount),
    unmatchedVideoCount: Number(row.unmatchedVideoCount),
    supplementaryVideoCount: Number(row.supplementaryVideoCount),
    inventoryVideoCount: Number(row.inventoryVideoCount),
    aggregatePlayCount: row.aggregatePlayCount == null ? null : Number(row.aggregatePlayCount),
  }));
  const availableLetters = (JSON.parse(rows[0]?.availableLetters ?? '[]') as string[]).sort();

  return {
    items,
    total: Number(rows[0]?.total ?? 0),
    page: query.page,
    pageSize: query.pageSize,
    availableLetters,
  };
}
