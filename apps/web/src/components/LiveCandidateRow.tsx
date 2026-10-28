import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { LiveDiscoveryEvidence, LiveEvidenceField, LiveMatchProvider, LiveMatchStatus } from '@vidarr/shared-types';
import { api } from '../api/client';
import { ActionButton, ActionForm } from './ButtonFeedback';
import VideoThumb from './VideoThumb';

export interface LiveCandidateItem {
  id: number; title: string; url: string; externalId?: string; evidenceReport?: LiveDiscoveryEvidence;
  recording?: { claimedCoverage?: string; parts?: Array<{ available: boolean; serverCopies: unknown[] }>; queueItems?: Array<{ status: string }> } | null;
}
const labels: Record<LiveMatchStatus, string> = { notChecked: 'Not checked', pending: 'Pending', strong: 'Strong event match', possible: 'Possible', songOnly: 'Song only',
  noMatch: 'No match in checked results', conflict: 'Conflict', ambiguous: 'Ambiguous', error: 'Check failed', unavailable: 'Unavailable' };
const fields: Array<[LiveEvidenceField, string]> = [['artist', 'Artist'], ['song', 'Song(s)'], ['date', 'Performance date'], ['venue', 'Venue'], ['city', 'City / location'], ['event', 'Event / session']];
function CandidateThumbnail({ artistId, item }: { artistId: number; item: LiveCandidateItem }) {
  const host = useRef<HTMLDivElement>(null), [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || !host.current) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: '150px' });
    observer.observe(host.current); return () => observer.disconnect();
  }, []);
  const thumbnail = useQuery({ queryKey: ['live-discovery-thumbnail', artistId, item.id], queryFn: () => api.live.thumbnail(artistId, item.id),
    enabled: visible && /^[\w-]{11}$/.test(item.externalId ?? ''), staleTime: 86400_000, retry: false, refetchOnWindowFocus: false });
  useEffect(() => {
    if (!thumbnail.data) { setUrl(null); return; }
    const object = URL.createObjectURL(thumbnail.data); setUrl(object); return () => URL.revokeObjectURL(object);
  }, [thumbnail.data]);
  return <div ref={host} className="live-candidate-thumb" aria-label={`Thumbnail for ${item.title}`}><VideoThumb url={url} /></div>;
}
function EvidenceFields({ evidence }: { evidence?: LiveDiscoveryEvidence }) {
  return <dl className="live-candidate-evidence" aria-label="Known fields and their sources">{fields.map(([field, label]) => {
    const facts = evidence?.facts.filter(fact => fact.field === field) ?? [];
    const values = [...new Set(facts.map(fact => fact.value))];
    const conflict = Object.values(evidence?.checks ?? {}).some(check => check.status === 'conflict' && check.references[0]?.conflicts.includes(field));
    return <div key={field} className={conflict ? 'evidence-conflict' : undefined}><dt>{label}{conflict ? ' · conflict' : ''}</dt>
      <dd>{!values.length ? <span className="artist-meta">Unknown / not checked</span> : values.map(value => <div key={value}>
        <span>{value}</span><small>{facts.filter(fact => fact.value === value).map((fact, index) => <span key={`${fact.source}-${index}`}>
          {index > 0 && ' · '}{fact.url ? <a href={fact.url} target="_blank" rel="noopener noreferrer">{fact.source}</a> : fact.source}
          {fact.basis === 'reference' && ' (reference; association unconfirmed)'}{fact.basis === 'claim' && ' (claim)'}
        </span>)}</small>
      </div>)}</dd></div>;
  })}</dl>;
}
function ConfirmGrabDialog({ item, busy, error, onClose, onConfirm }: { item: LiveCandidateItem; busy: boolean; error?: string; onClose: () => void; onConfirm: (input: object) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [identity, setIdentity] = useState(false), [video, setVideo] = useState(false), [source, setSource] = useState(false), [acknowledged, setAcknowledged] = useState(false);
  const [coverage, setCoverage] = useState(item.recording?.claimedCoverage ?? 'unknown'), [notes, setNotes] = useState('');
  const conflict = Object.values(item.evidenceReport?.checks ?? {}).some(check => ['conflict', 'ambiguous'].includes(check.status));
  useEffect(() => { if (!dialog.current?.open) { if (dialog.current?.showModal) dialog.current.showModal(); else dialog.current?.setAttribute('open', ''); } }, []);
  return <dialog ref={dialog} className="live-confirm-dialog" aria-labelledby={`confirm-live-${item.id}`} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <h3 id={`confirm-live-${item.id}`}>Confirm and Grab · {item.title}</h3>
    <p><a href={item.url} target="_blank" rel="noopener noreferrer">Inspect this exact upload</a></p>
    <p>Reference matches do not prove this capture. Unknown dates/places stay unknown; this action does not merge event identities.</p>
    <ActionForm onSubmit={event => { event.preventDefault(); onConfirm({ identityConfirmed: identity, videoVerified: video, sourceConfirmed: source, conflictsAcknowledged: acknowledged, claimedCoverage: coverage, notes }); }}>
      <label><input type="checkbox" checked={identity} onChange={event => setIdentity(event.target.checked)} /> I confirmed the performer and reviewed the occasion evidence, including unknown details.</label>
      <label><input type="checkbox" checked={video} onChange={event => setVideo(event.target.checked)} /> I inspected actual moving performance video, not audio or a static image.</label>
      <label><input type="checkbox" checked={source} onChange={event => setSource(event.target.checked)} /> I approve this exact upload as the download source.</label>
      {conflict && <label><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /> I reviewed the conflicting/ambiguous references and am confirming independently.</label>}
      <label>Claimed coverage <select value={coverage} onChange={event => setCoverage(event.target.value)}>{[['unknown', 'Unknown'], ['individualSong', 'Individual song'], ['severalSongs', 'Several songs'], ['entirePerformance', 'Entire performance'], ['excerpt', 'Excerpt']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Review notes <textarea value={notes} maxLength={5000} onChange={event => setNotes(event.target.value)} /></label>
      <p>Download validation, import and playback-server confirmation still follow. <Link to="/live/settings">Configure Live destinations</Link>.</p>
      {error && <p role="alert">{error}</p>}
      <div className="form-row"><ActionButton className="confirm-and-grab" disabled={!identity || !video || !source || (conflict && !acknowledged) || busy}>Confirm and Grab</ActionButton><ActionButton type="button" className="secondary" disabled={busy} onClick={onClose}>Cancel</ActionButton></div>
    </ActionForm>
  </dialog>;
}
export default function LiveCandidateRow({ artistId, item, enabled, expanded, onToggle, onRefresh, onIgnore, ignoring }: {
  artistId: number; item: LiveCandidateItem; enabled: boolean; expanded: boolean; onToggle: () => void; onRefresh: () => void; onIgnore: () => void; ignoring: boolean;
}) {
  const [confirming, setConfirming] = useState(false), [message, setMessage] = useState('');
  const match = useMutation({ mutationFn: ({ provider, page = 1 }: { provider: LiveMatchProvider; page?: number }) => api.live.action(`artists/${artistId}/start/${item.id}/match`, { provider, page }), onSuccess: onRefresh });
  const grab = useMutation({ mutationFn: (body: object) => api.live.action<{ status: string; queueId?: number }>(`artists/${artistId}/start/${item.id}/confirm-grab`, body),
    onSuccess: result => { setConfirming(false); setMessage(result.status === 'alreadyAvailable' ? 'This recording is already available.' : 'Queued. Validation, import and server confirmation remain pending.'); onRefresh(); } });
  const queued = !!item.recording?.queueItems?.length;
  const owned = item.recording?.parts?.some(part => part.available || part.serverCopies.length > 0);
  const busy = match.isPending || grab.isPending || ignoring;
  return <div className="artist-row live-discovery-row" role="listitem"><div className="live-candidate-layout"><div className="live-candidate-content">
    <div className="artist-row-header"><CandidateThumbnail artistId={artistId} item={item} /><div className="artist-row-main"><strong className="artist-name">{item.title}</strong>
      <div className="live-match-flags">{(['setlist.fm', 'musicbrainz'] as const).map(provider => {
        const check = item.evidenceReport?.checks[provider], status = check?.status ?? 'notChecked';
        return <span key={provider} className={`status-chip live-match-${status}`} title={check?.error ?? check?.scope}>{provider === 'musicbrainz' ? 'MB' : 'setlist.fm'}: {labels[status]}</span>;
      })}</div><span className="artist-meta">YouTube · Live video candidate{queued ? ' · Queued' : owned ? ' · Available' : ' · Needs review'}</span></div>
      <div className="artist-row-actions"><ActionButton className="secondary" aria-expanded={expanded} aria-controls={`live-candidate-${item.id}`} onClick={onToggle}>{expanded ? 'Hide details' : 'Review candidate'}</ActionButton></div>
    </div>
    <div className="live-candidate-actions">
      <ActionButton className="secondary" disabled={!enabled || busy} onClick={() => match.mutate({ provider: 'setlist.fm' })}>setlist.fm match</ActionButton>
      <ActionButton className="secondary" disabled={!enabled || busy} onClick={() => match.mutate({ provider: 'musicbrainz' })}>MusicBrainz match</ActionButton>
      <ActionButton className="confirm-and-grab" disabled={!enabled || busy || queued || owned} onClick={() => { grab.reset(); setConfirming(true); }}>{owned ? 'Available' : queued ? 'Queued' : 'Confirm and Grab'}</ActionButton>
      <ActionButton className="secondary" disabled={busy} onClick={onIgnore}>Ignore</ActionButton>
    </div>
    {expanded && <div id={`live-candidate-${item.id}`} className="artist-accordion" role="region" aria-label={`Review ${item.title}`}>
      <p><a href={item.url} target="_blank" rel="noopener noreferrer">Inspect source video</a></p>
      <p>Ignore hides this suggestion across rescans; it does not delete media or cancel an existing download.</p>
      {(['setlist.fm', 'musicbrainz'] as const).map(provider => { const check = item.evidenceReport?.checks[provider]; return <section key={provider}><h4>{provider}</h4>
        <p>{check?.scope ?? 'Not checked'}{check?.checkedAt ? ` · ${new Date(check.checkedAt).toLocaleString()}` : ''}</p>{check?.error && <p role="alert">{check.error}</p>}
        {check?.references.map(reference => <p key={reference.id}><a href={reference.url} target="_blank" rel="noopener noreferrer">{reference.title}</a> · {labels[reference.status]}{reference.matches.length ? ` · agrees: ${reference.matches.join(', ')}` : ''}{reference.conflicts.length ? ` · differs: ${reference.conflicts.join(', ')}` : ''}</p>)}
        {provider === 'setlist.fm' && check?.hasMore && <ActionButton className="secondary" disabled={busy} onClick={() => match.mutate({ provider, page: (check.page ?? 1) + 1 })}>Check next setlist.fm page</ActionButton>}
      </section>; })}
    </div>}
    {message && <p role="status">{message}</p>}{match.error && <p role="alert">{match.error.message}</p>}
    </div><EvidenceFields evidence={item.evidenceReport} /></div>
    {confirming && <ConfirmGrabDialog item={item} busy={grab.isPending} error={grab.error?.message} onClose={() => setConfirming(false)} onConfirm={body => grab.mutate(body)} />}
  </div>;
}
