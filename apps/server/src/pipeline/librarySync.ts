import { prisma, logActivity } from '../db/client.js';
import { getLibraryConnectorProvider } from '../providers/library/index.js';
import { normalizeTitle } from './normalize.js';
import { refreshRecommendations } from './recommendations.js';
import { syncConnectorVideos } from './libraryVideoSync.js';
import type { QualityProfile, RootFolder } from '@prisma/client';
import { resolveArtistIdentityAndCatalog } from './artistIdentity.js';
import { scanEmbeddedMusicLibrary } from './embeddedMusicScan.js';
import { syncLibraryRecordings } from './libraryRecordingSync.js';
import { artistNameHint, isUsableArtistHint } from './artistObservation.js';

export class ConnectorSyncError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function recoverInterruptedLibrarySyncs(): Promise<void> {
  await prisma.libraryConnector.updateMany({ where: { OR: [{ syncRunning: true }, { videoSyncRunning: true }] }, data: {
    syncRunning: false, videoSyncRunning: false, lastSyncStatus: 'failed',
    lastSyncError: 'Library sync interrupted by restart; retry at the next permitted time.',
  } });
}

// Manual and scheduled synchronization share every observation, identity,
// inventory, enrichment and recommendation stage, including progress/recovery.
export async function syncLibraryConnector(id: number, automatic = false) {
  const connector = await prisma.libraryConnector.findUnique({ where: { id } });
  if (!connector) throw new ConnectorSyncError('Connector not found', 404);
  if (automatic && !connector.enabled) throw new ConnectorSyncError('Connector is disabled', 409);
  const selectedMusicLibrary = ['jellyfin', 'plex'].includes(connector.type);
  if (selectedMusicLibrary && !connector.musicLibraryId && !connector.videoLibraryId && !connector.musicPath)
    throw new ConnectorSyncError('Select a music/video library or embedded music path before synchronization', 400);

  const claimed = await prisma.libraryConnector.updateMany({
    where: { id, syncRunning: false, ...(automatic ? { enabled: true } : {}) },
    data: { syncRunning: true, syncProcessed: 0, syncTotal: null, lastSyncError: null },
  });
  if (!claimed.count) throw new ConnectorSyncError('A library sync is already running', 409);
  try {
    const syncStartedAt = new Date();
    const connectorArtists = selectedMusicLibrary && !connector.musicLibraryId ? []
      : await getLibraryConnectorProvider(connector.type).fetchArtists(connector);
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
    const canonicalByName = new Map<string, { id: number; name: string; musicbrainzMatchStatus: string }>();
    if (defaults[0] && defaults[1]) {
      const canonicalArtists = await prisma.artist.findMany({ select: { id: true, name: true, musicbrainzMatchStatus: true } });
      canonicalArtists.forEach((artist) => canonicalByName.set(normalizeTitle(artist.name), artist));
      const existingSources = await prisma.artistSource.findMany({
        where: { provider: connector.type, origin: `connector:${id}`, externalId: { not: null } },
        select: { externalId: true, artist: { select: { id: true, name: true, musicbrainzMatchStatus: true } } },
      });
      const canonicalByExternalId = new Map(existingSources.map((source) => [source.externalId!, source.artist]));
      for (const observation of artists) {
        const nameHint = artistNameHint(observation.name);
        if (!isUsableArtistHint(nameHint)) continue;
        const key = normalizeTitle(nameHint);
        // Stable connector identity wins over a display name. MusicBrainz
        // enrichment may rename an artist to its canonical spelling; the
        // next connector sync must update that artist, not recreate the old
        // spelling as a duplicate.
        let canonical = canonicalByExternalId.get(observation.externalId) ?? canonicalByName.get(key);
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
        canonicalByExternalId.set(observation.externalId, canonical);
        await prisma.artistSource.upsert({
          where: { artistId_provider_origin: { artistId: canonical.id, provider: connector.type, origin: `connector:${id}` } },
          update: { externalId: observation.externalId, lastSeenAt: new Date() },
          create: { artistId: canonical.id, provider: connector.type, externalId: observation.externalId, origin: `connector:${id}` },
        });
        // Only stable provider/embedded MBIDs auto-confirm during a library
        // sync. Name-only observations stay unmatched until candidate
        // discovery can present them for review.
        if (observation.musicbrainzArtistId && canonical.musicbrainzMatchStatus !== 'linked') {
          await resolveArtistIdentityAndCatalog(canonical.id, { ...observation, name: nameHint });
        }
      }
    }

    // The video half is shared with on-demand syncing before playlist creation
    // (pipeline/libraryVideoSync.ts). Observed artists above already exist, so
    // their lookup is handed over rather than rebuilt.
    const { videoCount } = await syncConnectorVideos(connector, {
      defaults: defaults as [RootFolder | null, QualityProfile | null],
      canonicalByName,
      onFetched: (count) => prisma.libraryConnector.update({
        where: { id },
        data: { syncTotal: artists.length + count },
      }).then(() => undefined),
    });

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

    const recommendations = await refreshRecommendations();
    await prisma.libraryConnector.update({
      where: { id },
      data: {
        lastSyncedAt: new Date(),
        lastSyncStatus: 'success',
        lastSyncError: null,
        syncRunning: false,
        syncProcessed: artists.length + videoCount,
        syncTotal: artists.length + videoCount,
      },
    });
    return {
      ok: true,
      artistCount: artists.length,
      videoCount,
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
    throw err;
  }

}

export async function syncAllLibraries(): Promise<string> {
  const connectors = await prisma.libraryConnector.findMany({ where: { enabled: true }, orderBy: { id: 'asc' }, select: { id: true, name: true } });
  let synced = 0, skipped = 0, failed = 0;
  for (const connector of connectors) {
    try { await syncLibraryConnector(connector.id, true); synced++; }
    catch (error) {
      if (error instanceof ConnectorSyncError && [404, 409].includes(error.status)) { skipped++; continue; }
      failed++;
      await prisma.libraryConnector.updateMany({ where: { id: connector.id }, data: { lastSyncStatus: 'failed', lastSyncError: (error as Error).message } });
      await logActivity('warn', 'library-sync:' + connector.id, error);
    }
  }
  const result = synced + ' libraries synced, ' + skipped + ' already running, ' + failed + ' failed';
  if (failed) throw Error(result + '; see Library Connectors for each failure');
  return result;
}
