import { prisma, logActivity } from '../db/client.js';
import {
  assessArtistCandidate,
  lookupMusicBrainzArtist,
  lookupRecordingArtistIds,
  lookupReleaseArtistIds,
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
  // A recording ID embedded in an observed file is independent evidence of
  // the credited MusicBrainz artist. Bound lookups for large audio libraries;
  // a failed lookup must not prevent ordinary name-based review.
  const recordings = await prisma.libraryRecording.findMany({
    where: {
      OR: [{ artistName: observedName }, { albumArtistName: observedName }],
      musicbrainzRecordingId: { not: null },
    },
    select: { musicbrainzRecordingId: true },
    distinct: ['musicbrainzRecordingId'],
    take: 2,
  });
  const recordingMatches = new Map<string, number>();
  for (const recording of recordings) {
    try {
      const creditedIds = await lookupRecordingArtistIds(recording.musicbrainzRecordingId!);
      for (const id of creditedIds) recordingMatches.set(id, (recordingMatches.get(id) ?? 0) + 1);
    } catch {
      // Search results remain usable while MusicBrainz is temporarily unavailable.
    }
  }
  const releases = await prisma.libraryRecording.findMany({
    where: {
      OR: [{ albumArtistName: observedName }, { albumArtistName: null, artistName: observedName }],
      musicbrainzReleaseId: { not: null },
    },
    select: { musicbrainzReleaseId: true },
    distinct: ['musicbrainzReleaseId'],
    take: 2,
  });
  const releaseMatches = new Map<string, number>();
  for (const release of releases) {
    try {
      const creditedIds = await lookupReleaseArtistIds(release.musicbrainzReleaseId!);
      for (const id of creditedIds) releaseMatches.set(id, (releaseMatches.get(id) ?? 0) + 1);
    } catch {
      // A release lookup is optional evidence, not a prerequisite for review.
    }
  }
  const assessed = candidates.map((candidate) => ({
    candidate,
    assessment: assessArtistCandidate(observedName, candidate, {
      genre,
      recordingMatchCount: recordingMatches.get(candidate.id) ?? 0,
      releaseMatchCount: releaseMatches.get(candidate.id) ?? 0,
    }),
  })).sort((left, right) => right.assessment.confidence - left.assessment.confidence);
  for (const { candidate, assessment } of assessed) {
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
  const best = assessed[0];
  const runnerUp = assessed[1];
  await prisma.artist.update({
    where: { id: artistId },
    data: {
      musicbrainzMatchStatus: best ? (runnerUp && best.assessment.confidence - runnerUp.assessment.confidence < 0.1 ? 'ambiguous' : 'suggested') : 'notFound',
      musicbrainzMatchConfidence: best?.assessment.confidence ?? null,
      musicbrainzMatchEvidence: best ? evidenceJson(best.assessment) : null,
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
