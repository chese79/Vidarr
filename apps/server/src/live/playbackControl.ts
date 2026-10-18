import { prisma } from '../db/client.js';
import { getLibraryConnectorProvider } from '../providers/library/index.js';
import { LiveError } from './policy.js';
import { playbackServerKey } from './playback.js';
import { redactMessage } from '../security/redact.js';

export async function playbackChoices(recordingId: number) {
  const parts = await prisma.recordingPart.findMany({ where: { recordingId }, include: { serverCopies: { where: { available: true, connector: { enabled: true } }, include: { connector: true } } }, orderBy: { position: 'asc' } });
  const choices = [];
  const seen = new Set<string>();
  for (const part of parts) for (const copy of part.serverCopies) {
    const key = `${copy.connectorId}:${copy.libraryId}`; if (seen.has(key)) continue; seen.add(key);
    const provider = getLibraryConnectorProvider(copy.connector.type);
    let supported = Boolean(provider.startVideoPlayback && provider.listPlaybackClients), failure = '';
    let clients: Array<{ id: string; name: string; userId: string }> = [];
    if (supported) try { clients = await provider.listPlaybackClients!({ ...copy.connector, videoLibraryId: copy.libraryId }); }
    catch (error) { supported = false; failure = redactMessage(error); }
    choices.push({ connectorId: copy.connectorId, libraryId: copy.libraryId, name: copy.connector.name, supported,
      boundedSegments: false, clients,
      explanation: failure ? `Playback server unavailable: ${failure}` : supported ? 'Start offsets and ordered whole parts; a chapter does not stop playback at its end' : 'Remote starting offsets are unverified for this connector. Open the recording in your playback client.' });
  }
  return choices;
}
export async function startRecordingPlayback(recordingId: number, request: { connectorId: number; libraryId: string; sessionId: string; userId: string; viewingId?: number; songId?: number }) {
  const recording = await prisma.recording.findUniqueOrThrow({ where: { id: recordingId }, include: { parts: { orderBy: { position: 'asc' }, include: { serverCopies: true, coverage: true } } } });
  if (recording.catalogType !== 'live' || recording.deletionState || !recording.parts.length || !recording.videoVerified || !recording.identityVerified) throw new LiveError('Choose an eligible recording without pending deletion');
  const configured = await prisma.libraryConnector.findUniqueOrThrow({ where: { id: request.connectorId, enabled: true } });
  const connector = { ...configured, videoLibraryId: request.libraryId }, provider = getLibraryConnectorProvider(connector.type);
  if (!provider.startVideoPlayback) throw new LiveError('Use your playback client; starting offsets are not verified for this connector');
  let start = 0, first = 0;
  if (request.viewingId) {
    const view = await prisma.liveViewing.findUniqueOrThrow({ where: { id: request.viewingId } });
    const serverKey = playbackServerKey(connector.type, connector.host);
    if (view.serverKey !== serverKey || view.userId !== request.userId || !view.active) throw new LiveError('Choose an unfinished viewing belonging to this server user');
    first = recording.parts.findIndex(part => part.id === view.partId);
    if (first < 0) throw new LiveError('Resume belongs to another recording version; choose that version rather than guessing a timestamp');
    start = view.positionSeconds;
  }
  if (request.songId) {
    first = recording.parts.findIndex(part => part.coverage.some(item => item.songId === request.songId && item.verified && item.startSeconds != null));
    if (first < 0) throw new LiveError('Verify this chapter boundary before jumping to it');
    start = recording.parts[first].coverage.find(item => item.songId === request.songId)!.startSeconds!;
  }
  const externalIds = recording.parts.slice(first).map(part => part.serverCopies.find(copy => copy.connectorId === connector.id && copy.libraryId === request.libraryId && copy.available)?.externalId);
  if (externalIds.some(id => !id)) throw new LiveError('Confirm every remaining part in this playback library before starting an ordered recording');
  await provider.startVideoPlayback(connector, { sessionId: request.sessionId, userId: request.userId, externalIds: externalIds as string[], positionSeconds: start });
  return { sent: true, confirmedPlaying: false, positionSeconds: start, boundedSegment: false };
}
