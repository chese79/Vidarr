import { prisma, logActivity } from '../db/client.js';
import {
  assessArtistCandidate,
  lookupMusicBrainzArtist,
  searchMusicBrainzArtists,
  getMusicBrainzVideoRecordings,
  type MusicBrainzArtist,
} from '../providers/metadata/musicbrainz.js';
import { searchArtists as searchImvdbArtists } from '../providers/metadata/imvdb.js';
import { refreshArtistMetadata } from './metadataRefresh.js';
import { normalizeTitle } from './normalize.js';

function evidenceJson(value: unknown) {
  return JSON.stringify(value);
}

async function enrichConfirmedArtist(artistId: number, mbid: string, observedGenre?: string | null) {
  const metadata = await lookupMusicBrainzArtist(mbid);
  const current = await prisma.artist.findUniqueOrThrow({ where: { id: artistId } });
  const genre = current.genre ?? observedGenre ?? metadata.genres[0] ?? null;
  const genreSource = current.genre
    ? current.genreSource
    : observedGenre
      ? 'connector'
      : metadata.genres[0]
        ? 'musicbrainz'
        : null;
  await prisma.artist.update({
    where: { id: artistId },
    data: {
      name: metadata.name,
      sortName: metadata.sortName,
      artistType: metadata.type,
      country: metadata.country,
      disambiguation: metadata.disambiguation,
      genre,
      genreSource,
      musicbrainzArtistId: mbid,
      musicbrainzMatchStatus: 'confirmed',
      musicbrainzMatchConfidence: 1,
      musicbrainzMatchEvidence: evidenceJson({ source: 'embedded-or-connector-mbid' }),
      musicbrainzRefreshedAt: new Date(),
    },
  });
  await prisma.artistSource.upsert({
    where: { artistId_provider_origin: { artistId, provider: 'musicbrainz', origin: 'identity-resolution' } },
    update: { externalId: mbid, lastSeenAt: new Date() },
    create: { artistId, provider: 'musicbrainz', externalId: mbid, origin: 'identity-resolution' },
  });
  return metadata;
}

async function refreshSupplementaryVideos(artistId: number, artistMbid: string) {
  const recordings = await getMusicBrainzVideoRecordings(artistMbid);
  for (const recording of recordings) {
    const normalizedTitle = normalizeTitle(recording.title);
    const collision = await prisma.musicVideo.findFirst({ where: { artistId, normalizedTitle } });
    const saved = collision
      ? await prisma.musicVideo.update({
          where: { id: collision.id },
          data: {
            musicbrainzRecordingId: collision.musicbrainzRecordingId ?? recording.id,
            musicbrainzAudioRecordingId: collision.musicbrainzAudioRecordingId ?? recording.audioRecordingId,
          },
        })
      : await prisma.musicVideo.upsert({
          where: { musicbrainzRecordingId: recording.id },
          update: { title: recording.title, releaseYear: recording.releaseYear },
          create: {
            artistId,
            title: recording.title,
            normalizedTitle,
            releaseYear: recording.releaseYear,
            musicbrainzRecordingId: recording.id,
            musicbrainzAudioRecordingId: recording.audioRecordingId,
            catalogKind: 'supplementary',
            monitored: false,
          },
        });
    for (const source of recording.sources) {
      await prisma.acquisitionSource.upsert({
        where: { musicVideoId_provider_url: { musicVideoId: saved.id, provider: source.provider, url: source.url } },
        update: { externalId: source.externalId, confidence: 'confirmed' },
        create: {
          musicVideoId: saved.id,
          provider: source.provider,
          externalId: source.externalId,
          url: source.url,
          authority: 'verified',
          confidence: 'confirmed',
          discoveryOrigin: 'musicbrainz-recording-relation',
          accepted: true,
        },
      });
    }
  }
}

async function storeCandidates(artistId: number, observedName: string, candidates: MusicBrainzArtist[], genre?: string | null) {
  for (const candidate of candidates) {
    const assessment = assessArtistCandidate(observedName, candidate, { genre });
    await prisma.musicBrainzArtistCandidate.upsert({
      where: { artistId_musicbrainzArtistId: { artistId, musicbrainzArtistId: candidate.id } },
      update: {
        name: candidate.name,
        sortName: candidate.sortName,
        artistType: candidate.type,
        country: candidate.country,
        disambiguation: candidate.disambiguation,
        score: assessment.confidence,
        evidence: evidenceJson(assessment),
        lastSeenAt: new Date(),
      },
      create: {
        artistId,
        musicbrainzArtistId: candidate.id,
        name: candidate.name,
        sortName: candidate.sortName,
        artistType: candidate.type,
        country: candidate.country,
        disambiguation: candidate.disambiguation,
        score: assessment.confidence,
        evidence: evidenceJson(assessment),
      },
    });
  }
  const best = candidates[0];
  const assessment = best ? assessArtistCandidate(observedName, best, { genre }) : null;
  await prisma.artist.update({
    where: { id: artistId },
    data: {
      musicbrainzMatchStatus: best ? (candidates.length > 1 && (best.score ?? 0) - (candidates[1].score ?? 0) < 10 ? 'ambiguous' : 'suggested') : 'notFound',
      musicbrainzMatchConfidence: assessment?.confidence ?? null,
      musicbrainzMatchEvidence: assessment ? evidenceJson(assessment) : null,
      musicbrainzRefreshedAt: new Date(),
    },
  });
}

export async function resolveArtistIdentityAndCatalog(
  artistId: number,
  observation: { name: string; musicbrainzArtistId?: string | null; genre?: string | null },
) {
  try {
    let metadata: MusicBrainzArtist | null = null;
    if (observation.musicbrainzArtistId) {
      metadata = await enrichConfirmedArtist(artistId, observation.musicbrainzArtistId, observation.genre);
    } else {
      const existing = await prisma.artist.findUniqueOrThrow({ where: { id: artistId } });
      if (existing.musicbrainzArtistId) metadata = await enrichConfirmedArtist(artistId, existing.musicbrainzArtistId, observation.genre);
      else {
        await storeCandidates(artistId, observation.name, await searchMusicBrainzArtists(observation.name), observation.genre);
        return;
      }
    }

    const artist = await prisma.artist.findUniqueOrThrow({ where: { id: artistId } });
    await refreshSupplementaryVideos(artistId, metadata.id);
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    if (!artist.imvdbArtistId && settings?.imvdbApiKey) {
      const candidates = await searchImvdbArtists(settings.imvdbApiKey, metadata.name);
      const exact = candidates.filter((candidate) => candidate.name.localeCompare(metadata.name, undefined, { sensitivity: 'base' }) === 0);
      if (exact.length === 1) {
        await prisma.artist.update({ where: { id: artistId }, data: { imvdbArtistId: exact[0].slug } });
      }
    }
    const updated = await prisma.artist.findUniqueOrThrow({ where: { id: artistId } });
    if (updated.imvdbArtistId) await refreshArtistMetadata(artistId);
  } catch (error) {
    await prisma.artist.update({ where: { id: artistId }, data: { musicbrainzMatchStatus: 'failed' } });
    await logActivity('warn', 'artist-identity', error);
  }
}

export async function discoverArtistIdentityCandidates(artistId: number) {
  const artist = await prisma.artist.findUniqueOrThrow({ where: { id: artistId } });
  const candidates = await searchMusicBrainzArtists(artist.name);
  await storeCandidates(artistId, artist.name, candidates, artist.genre);
  return prisma.musicBrainzArtistCandidate.findMany({
    where: { artistId, status: 'suggested' },
    orderBy: { score: 'desc' },
  });
}

export async function confirmArtistIdentity(artistId: number, musicbrainzArtistId: string) {
  await prisma.musicBrainzArtistCandidate.updateMany({
    where: { artistId, musicbrainzArtistId: { not: musicbrainzArtistId } },
    data: { status: 'rejected' },
  });
  const artist = await prisma.artist.findUniqueOrThrow({ where: { id: artistId } });
  await resolveArtistIdentityAndCatalog(artistId, {
    name: artist.name,
    genre: artist.genre,
    musicbrainzArtistId,
  });
  return prisma.artist.findUniqueOrThrow({ where: { id: artistId } });
}
