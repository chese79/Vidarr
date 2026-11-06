import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { EnrichmentField, EnrichmentItem } from '@vidarr/shared-types';
import { api } from '../api/client';

const display = (value: unknown) => Array.isArray(value) ? value.join(', ') : value == null || value === '' ? 'Missing' : String(value);
function Review({ item, onApplied }: { item: EnrichmentItem; onApplied: () => void }) {
  const [choice, setChoice] = useState(Math.min(item.proposal?.reviewRequest?.evidenceIndex ?? 0, Math.max(0, (item.proposal?.evidence.length ?? 0) - 1)));
  const [selected, setSelected] = useState<EnrichmentField[]>(item.proposal?.reviewRequest?.fields ?? []);
  const [corrections, setCorrections] = useState(!!item.proposal?.reviewRequest?.corrections.length);
  const evidence = item.proposal?.evidence ?? [];
  const apply = useMutation({ mutationFn: () => api.metadataEnrichment.apply(item.id, { evidenceIndex: choice, fields: selected, corrections }), onSuccess: onApplied });
  return <details><summary>{item.artistName} — {item.title} · {item.status}{item.changed ? ' · metadata updated' : ''}</summary>
    {item.error && <p role="alert">{item.error}</p>}
    {item.proposal?.notes.map(note => <p key={note}>{note}</p>)}
    <p><Link to="/match-review">Artist Review</Link> · <Link to="/video-review">Video Review</Link></p>
    <p>Still missing: {item.proposal?.missing.join(', ') || 'None'}. Suggestions below are evidence, and may require identity or edition review.</p>
    {evidence[choice] && <>
      <label>Evidence <select value={choice} onChange={event => { setChoice(Number(event.target.value)); setSelected([]); setCorrections(false); }}>{evidence.map((row, index) => <option value={index} key={index}>{row.source} — {row.entityId}</option>)}</select></label>
      <p><a href={evidence[choice].url} target="_blank" rel="noreferrer">{evidence[choice].source}</a> · observed {new Date(evidence[choice].observedAt).toLocaleString()}</p>
      <p>{evidence[choice].reason}</p>
      {evidence[choice].requiresArtistReview && <p>Artist identity review is required before these external facts can be applied.</p>}
      <table><thead><tr><th>Apply</th><th>Field</th><th>Current</th><th>Proposed</th></tr></thead><tbody>{Object.entries(evidence[choice].facts).filter(([, value]) => value != null).map(([field, value]) => <tr key={field}><td><input type="checkbox" aria-label={`Apply ${field}`} checked={selected.includes(field as EnrichmentField)} onChange={event => setSelected(event.target.checked ? [...selected, field as EnrichmentField] : selected.filter(value => value !== field))} /></td><td>{field}</td><td>{display(item.before?.Facts[field as EnrichmentField])}</td><td>{display(value)}</td></tr>)}</tbody></table>
      <label><input type="checkbox" checked={corrections} onChange={event => setCorrections(event.target.checked)} /> I reviewed the identity, video version and release evidence; allow selected populated fields to be corrected.</label>
      <p><button disabled={!selected.length || apply.isPending || evidence[choice].requiresArtistReview} onClick={() => apply.mutate()}>{apply.isPending ? 'Applying and verifying…' : 'Apply selected facts'}</button></p>
      {apply.error && <p role="alert">{apply.error.message}</p>}
      {apply.isSuccess && <p role="status">Jellyfin metadata and MTV track verified.</p>}
    </>}
  </details>;
}
export default function MetadataEnrichmentPage() {
  const cache = useQueryClient();
  const [connectorId, setConnectorId] = useState(0);
  const [runId, setRunId] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const connectors = useQuery({ queryKey: ['libraryconnectors'], queryFn: api.libraryConnectors.list });
  const runs = useQuery({ queryKey: ['metadata-enrichment'], queryFn: api.metadataEnrichment.list, refetchInterval: 5000 });
  const current = runs.data?.find(run => run.id === runId) ?? runs.data?.[0];
  const items = useQuery({ queryKey: ['metadata-enrichment-items', current?.id, page, search, status], queryFn: () => api.metadataEnrichment.items(current!.id, page, search, status), enabled: !!current, refetchInterval: current?.status === 'running' ? 5000 : false });
  const refresh = () => { void cache.invalidateQueries({ queryKey: ['metadata-enrichment'] }); void cache.invalidateQueries({ queryKey: ['metadata-enrichment-items'] }); };
  const start = useMutation({ mutationFn: () => api.metadataEnrichment.start(connectorId), onSuccess: run => { setRunId(run.id); setPage(1); refresh(); } });
  const control = useMutation({ mutationFn: (action: 'pause' | 'resume' | 'retry' | 'cancel') => api.metadataEnrichment.control(current!.id, action), onSuccess: refresh });
  return <section><h2>MTV metadata enrichment</h2>
    <p>Standard Jellyfin music-video scans queue enrichment automatically. Verified facts fill missing, unlocked metadata and refresh the MTV track. Uncertain identities and editions remain for review. Requires MTV plugin 0.1.4 or newer.</p>
    <label>Library <select value={connectorId} onChange={event => setConnectorId(Number(event.target.value))}><option value={0}>Select Jellyfin connector</option>{connectors.data?.filter(connector => connector.enabled && connector.type === 'jellyfin' && connector.videoLibraryId).map(connector => <option key={connector.id} value={connector.id}>{connector.name}</option>)}</select></label>{' '}
    <button disabled={!connectorId || start.isPending} onClick={() => start.mutate()}>Enrich current inventory</button>
    {start.error && <p role="alert">{start.error.message}</p>}
    {runs.error && <p role="alert">{runs.error.message}</p>}
    {current && <>
      <p><label>Batch <select value={current.id} onChange={event => { setRunId(Number(event.target.value)); setPage(1); }}>{runs.data?.map(run => <option key={run.id} value={run.id}>#{run.id} — {run.status} — {new Date(run.createdAt).toLocaleString()}</option>)}</select></label></p>
      <p role="status">{current.status} · {current.processed} checked · {current.updated} updated · {current.completeCount} complete · {current.reviewCount} review · {current.unknownCount} unknown · {current.failedCount} failed</p>
      {current.currentItem && <p>Current item: {current.currentItem.artistName} — {current.currentItem.title}</p>}
      {current.error && <p role="alert">{current.error}</p>}
      <p><button disabled={control.isPending || !['paused', 'queued'].includes(current.status)} onClick={() => control.mutate('cancel')}>Cancel batch, retain audit</button>{' '}<button disabled={control.isPending || current.status !== 'running'} onClick={() => control.mutate('pause')}>Pause after current item</button>{' '}<button disabled={control.isPending || current.status !== 'paused'} onClick={() => control.mutate('resume')}>Resume</button>{' '}<button disabled={control.isPending || !current.failedCount} onClick={() => control.mutate('retry')}>Retry failed</button></p>
      {control.error && <p role="alert">{control.error.message}</p>}
      <p><label>Search <input value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} /></label>{' '}<label>Status <select value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="">All</option>{['pending', 'updated', 'complete', 'review', 'unknown', 'failed'].map(value => <option key={value}>{value}</option>)}</select></label></p>
      {items.error && <p role="alert">{items.error.message}</p>}
      {items.isLoading ? <p>Loading…</p> : items.data?.items.map(item => <Review key={JSON.stringify([item.id, item.before?.Fingerprint, item.proposal])} item={item} onApplied={refresh} />)}
      <p><button disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button> Page {page} · {items.data?.total ?? 0} items <button disabled={page * 25 >= (items.data?.total ?? 0)} onClick={() => setPage(page + 1)}>Next</button></p>
    </>}
  </section>;
}
