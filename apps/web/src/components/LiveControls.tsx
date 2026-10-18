import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { LiveConfigurationView } from '@vidarr/shared-types';

function PlaybackLibraryPicker({ connectorId, value, onChange }: { connectorId: number | null; value: string | null; onChange: (value: string | null) => void }) {
  const sections = useQuery({ queryKey: ['live-library-sections', connectorId], queryFn: () => api.libraryConnectors.sections(connectorId!), enabled: !!connectorId });
  return <label>Playback library <select disabled={!connectorId || sections.isPending} value={value ?? ''} onChange={e => onChange(e.target.value || null)}><option value="">Choose a verified video library</option>
    {sections.data?.filter(section => ['musicvideos', 'movie'].includes(section.type)).map(section => <option key={section.id} value={section.id}>{section.title}</option>)}</select>{sections.isError && <span role="alert">Could not load libraries: {sections.error.message}</span>}</label>;
}

interface Preview { performances: number; knownRecordings: number; shared: number; estimatedSearches: { min: number; max: number }; estimatedDays: { min: number; max: number }; explanation: string }
export function LiveDiscoveryControls({ artistId, performanceId }: { artistId: number; performanceId?: number }) {
  const cache = useQueryClient();
  const [page, setPage] = useState(1), [from, setFrom] = useState(''), [to, setTo] = useState(''), [budget, setBudget] = useState(50);
  const [preview, setPreview] = useState<Preview>();
  const [source, setSource] = useState('all');
  const [tour, setTour] = useState(''), [setting, setSetting] = useState(''), [style, setStyle] = useState(''), [origin, setOrigin] = useState(''), [coverage, setCoverage] = useState('');
  const input = { artistId, performanceId: performanceId ?? null, from: from || undefined, to: to || undefined, dailyBudget: budget,
    tour: tour || null, settings: setting ? [setting] : [], styles: style ? [style] : [], origins: origin ? [origin] : [], coverage: coverage ? [coverage] : [], sources: source === 'all' ? ['youtube', 'indexer'] : [source] };
  const discover = useMutation({ mutationFn: () => api.live.action<{ hasMore: boolean; ids: number[] }>(`artists/${artistId}/discover`, { page }),
    onSuccess: () => { cache.invalidateQueries({ queryKey: ['live-performances'] }); } });
  const search = useMutation({ mutationFn: () => api.live.action<{ candidates: number; errors: string[]; deferred: boolean }>(`performances/${performanceId}/search`, {}),
    onSuccess: () => { cache.invalidateQueries({ queryKey: ['live-performance', performanceId] }); } });
  const estimate = useMutation({ mutationFn: () => api.live.action<Preview>('monitoring/preview', input), onSuccess: setPreview });
  const activate = useMutation({ mutationFn: () => api.live.action('monitoring', { ...input, approved: true }), onSuccess: () => { cache.invalidateQueries({ queryKey: ['live-monitoring'] }); } });
  return <details className="card"><summary>Discovery and monitoring</summary>
    <p>Browse one setlist.fm history page at a time. Adding an artist does not import its entire live history. Video searches are separate and send uncertain candidates to review.</p>
    <button disabled={discover.isPending} onClick={() => discover.mutate()}>Load event history, page {page}</button>{' '}
    {discover.data?.hasMore && <button onClick={() => { setPage(page + 1); discover.reset(); }}>Next history page</button>}
    {discover.isSuccess && <p role="status">Reviewed {discover.data.ids.length} reference events. <a href="https://www.setlist.fm" target="_blank" rel="noreferrer">Setlist data from setlist.fm</a></p>}
    {performanceId && <button disabled={search.isPending} onClick={() => search.mutate()}>Search videos now</button>}
    {search.data && <p role="status">{search.data.candidates} new candidates. {search.data.deferred && 'Budget reached; unfinished work is deferred.'} {search.data.errors.join(' ')}</p>}
    <h4>Preview automatic monitoring</h4><p>Monitoring authorizes bounded searches and eligible acquisition. Narrow the scope before activating.</p>
    <label>Tour <input value={tour} onChange={e => { setTour(e.target.value); setPreview(undefined); }} placeholder="All tours" /></label>
    <label>Setting <select value={setting} onChange={e => { setSetting(e.target.value); setPreview(undefined); }}><option value="">All settings</option><option value="concert">Concert</option><option value="festival">Festival</option><option value="televisionRadio">Television / radio</option><option value="studioSession">Studio session</option><option value="informalGathering">Informal gathering</option></select></label>
    <label>Style <select value={style} onChange={e => { setStyle(e.target.value); setPreview(undefined); }}><option value="">All styles</option><option value="acoustic">Acoustic</option><option value="electric">Electric</option><option value="mixed">Mixed</option><option value="unknown">Unknown</option></select></label>
    <label>Recording origin <select value={origin} onChange={e => { setOrigin(e.target.value); setPreview(undefined); }}><option value="">All origins</option><option value="professional">Professional</option><option value="audience">Audience</option><option value="unknown">Unknown</option></select></label>
    <label>Recording coverage <select value={coverage} onChange={e => { setCoverage(e.target.value); setPreview(undefined); }}><option value="">All coverage</option><option value="entirePerformance">Entire performance</option><option value="severalSongs">Several songs</option><option value="individualSong">Individual song</option><option value="excerpt">Excerpt</option></select></label>
    <label>From year or date <input value={from} onChange={e => { setFrom(e.target.value); setPreview(undefined); }} placeholder="YYYY or YYYY-MM-DD" /></label>
    <label>To year or date <input value={to} onChange={e => { setTo(e.target.value); setPreview(undefined); }} placeholder="YYYY or YYYY-MM-DD" /></label>
    <label>Daily search budget <input type="number" min="1" max="500" value={budget} onChange={e => { setBudget(Number(e.target.value)); setPreview(undefined); }} /></label>
    <button disabled={estimate.isPending} onClick={() => estimate.mutate()}>Estimate searches</button>
    <label>Search sources <select value={source} onChange={e => { setSource(e.target.value); setPreview(undefined); }}><option value="all">YouTube and enabled indexers</option><option value="youtube">YouTube</option><option value="indexer">Enabled indexers</option></select></label>
    {preview && <><p>{preview.performances} performances · {preview.knownRecordings} known recordings · {preview.shared} already shared with monitoring.</p>
      <p>Estimated {preview.estimatedSearches.min}–{preview.estimatedSearches.max} searches over {preview.estimatedDays.min}–{preview.estimatedDays.max} budget days.</p><p>{preview.explanation}</p>
      <button disabled={activate.isPending} onClick={() => activate.mutate()}>Activate this monitoring scope</button></>}
    {activate.isSuccess && <p role="status">Monitoring activated. <Link to="/live/settings">Manage monitoring and budgets</Link>.</p>}
    {[discover.error, search.error, estimate.error, activate.error].filter(Boolean).map((error, index) => <p role="alert" key={index}>{error?.message}</p>)}
  </details>;
}

export function LiveSettings() {
  const cache = useQueryClient();
  const config = useQuery({ queryKey: ['live-configuration'], queryFn: api.live.configuration });
  const roots = useQuery({ queryKey: ['rootfolders'], queryFn: api.rootFolders.list });
  const connectors = useQuery({ queryKey: ['libraryconnectors'], queryFn: api.libraryConnectors.list });
  const rules = useQuery({ queryKey: ['live-monitoring'], queryFn: api.live.monitoring });
  const failures = useQuery({ queryKey: ['live-search-status'], queryFn: () => api.live.read<Array<{ key: string; provider: string; outcome: string; retryAt: string | null }>>('search-status'), refetchInterval: 30000 });
  const [exclusionOffset, setExclusionOffset] = useState(0);
  const exclusions = useQuery({ queryKey: ['live-exclusions', exclusionOffset], queryFn: () => api.live.read<Array<{ id: number; artistName: string; scope: string; fingerprint: string }>>(`exclusions?offset=${exclusionOffset}`) });
  const restoreExclusion = useMutation({ mutationFn: (id: number) => api.live.action(`exclusions/${id}/restore`, {}), onSuccess: () => cache.invalidateQueries({ queryKey: ['live-exclusions'] }) });
  const [draft, setDraft] = useState<LiveConfigurationView['policy']>(), [key, setKey] = useState('');
  const policy = draft ?? config.data?.policy;
  const save = useMutation({ mutationFn: () => api.live.action('configuration', { policy, ...(key ? { setlistApiKey: key } : {}) }, 'PUT'), onSuccess: () => { setKey(''); cache.invalidateQueries({ queryKey: ['live-configuration'] }); } });
  const ruleAction = useMutation({ mutationFn: ({ id, state }: { id: number; state: string }) => api.live.action(`monitoring/${id}`, { state }, 'PATCH'), onSuccess: () => cache.invalidateQueries({ queryKey: ['live-monitoring'] }) });
  if (!policy) return <p>{config.isError ? config.error.message : 'Loading live settings…'}</p>;
  const change = (values: Partial<typeof policy>) => setDraft({ ...policy, ...values });
  return <><Link to="/live">Live</Link><h2>Live settings</h2><form onSubmit={e => { e.preventDefault(); save.mutate(); }}>
    <section className="card"><h3>Setlist.fm</h3><label>API key <input type="password" autoComplete="new-password" placeholder={config.data?.hasSetlistApiKey ? 'Configured; leave blank to retain' : 'Enter API key'} value={key} onChange={e => setKey(e.target.value)} /></label>
      {config.data?.setlistPaused && <p role="alert">Authentication paused. Save a corrected key to resume.</p>}{config.data?.providerRetryAt && <p>Provider retry: {new Date(config.data.providerRetryAt).toLocaleString()}</p>}
      <p>Event references and setlists use <a href="https://www.setlist.fm" target="_blank" rel="noreferrer">setlist.fm</a>. A reference does not prove an eligible video exists.</p></section>
    <section className="card"><h3>Live destinations and validation</h3><p>These destinations apply to new imports. Existing files remain where they are. Unknown classification always uses all four stages until classified. Import and exact playback-server confirmation are always required. Both optional deep checks default on. Full-file integrity decodes video/audio throughout the file; motion inspection checks for mostly static footage. Disabling a deep check retains basic video and bounded motion eligibility plus identity review.</p>
      {(['full', 'song'] as const).map(kind => <fieldset key={kind}><legend>{kind === 'full' ? 'Full / multipart performances' : 'Individual live songs'}</legend>
        <label>Destination folder <select value={policy[`${kind}RootFolderId`] ?? ''} onChange={e => change({ [`${kind}RootFolderId`]: e.target.value ? Number(e.target.value) : null })}><option value="">Choose folder</option>{roots.data?.map(root => <option key={root.id} value={root.id}>{root.path}</option>)}</select></label>
        <label>Playback connector <select value={policy[`${kind}ConnectorId`] ?? ''} onChange={e => change({ [`${kind}ConnectorId`]: e.target.value ? Number(e.target.value) : null, [`${kind}LibraryId`]: null })}><option value="">Local only</option>{connectors.data?.filter(connector => connector.enabled && ['plex', 'jellyfin'].includes(connector.type)).map(connector => <option key={connector.id} value={connector.id}>{connector.name}</option>)}</select></label>
        <PlaybackLibraryPicker connectorId={policy[`${kind}ConnectorId`]} value={policy[`${kind}LibraryId`]} onChange={value => change({ [`${kind}LibraryId`]: value })} />
        <label><input type="checkbox" checked={policy[kind].file} onChange={e => change({ [kind]: { ...policy[kind], file: e.target.checked } })} /> Check full-file integrity</label>
        <label><input type="checkbox" checked={policy[kind].motion} onChange={e => change({ [kind]: { ...policy[kind], motion: e.target.checked } })} /> Check motion throughout the recording</label>
      </fieldset>)}</section>
    <section className="card"><h3>Search and retention</h3>
      <label>Global daily search budget <input type="number" min="1" max="10000" value={policy.globalDailyBudget} onChange={e => change({ globalDailyBudget: Number(e.target.value) })} /></label>
      <label>Unmonitored discovery retention, days <input type="number" min="1" value={policy.discoveryRetentionDays} onChange={e => change({ discoveryRetentionDays: Number(e.target.value) })} /></label>
      <label>Lightweight search history retention, days <input type="number" min="90" value={policy.journalRetentionDays} onChange={e => change({ journalRetentionDays: Number(e.target.value) })} /></label>
      <p>Owned, monitored, edited and review-pending entries are protected. Viewing and resume history are retained indefinitely.</p>
    </section>
    <section className="card"><h3>Recording preference</h3><p>Only verified improvements can trigger upgrades. Unknown properties do not win comparisons; ties retain the current recording. Pins and unique coverage protect existing versions. Source origin does not override these checks.</p>
      {policy.qualityOrder.map((value, index) => <label key={index}>Priority {index + 1} <select value={value} onChange={e => {
        const order = [...policy.qualityOrder], other = order.indexOf(e.target.value as typeof value); order[index] = order[other]; order[other] = value; change({ qualityOrder: order });
      }}>{(['coverage', 'audio', 'visual', 'resolution'] as const).map(item => <option key={item} value={item}>{item}</option>)}</select></label>)}
      <label>Origin preference when otherwise eligible <select value={policy.preferredOrigin} onChange={e => change({ preferredOrigin: e.target.value as typeof policy.preferredOrigin })}><option value="unknown">No origin preference</option><option value="professional">Professional</option><option value="audience">Audience</option></select></label>
      <label><input type="checkbox" checked={policy.cleanupRedundantRecordings} onChange={e => change({ cleanupRedundantRecordings: e.target.checked })} /> Offer cleanup of redundant recordings after verified replacement delivery</label><p>Older versions are retained by default. Cleanup protects pins, unique song coverage, playlists and unfinished viewings. Delete warnings, delays and playback checks still apply.</p>
    </section><button disabled={save.isPending}>Save live settings</button>{save.isSuccess && <p role="status">Live settings saved; queued downloads read these choices when validation starts.</p>}{save.isError && <p role="alert">{save.error.message}</p>}
  </form><h3>Discovery exclusions</h3><p>Restoring an exclusion allows future discovery. It does not restore deleted media.</p>{exclusions.data?.map(item => <p key={item.id}>{item.artistName} · {item.scope} · {item.fingerprint}{' '}<button disabled={restoreExclusion.isPending} onClick={() => restoreExclusion.mutate(item.id)}>Allow future discovery again</button></p>)}
  <button disabled={!exclusionOffset} onClick={() => setExclusionOffset(Math.max(0, exclusionOffset - 25))}>Previous exclusions</button>{' '}<button disabled={(exclusions.data?.length ?? 0) < 25} onClick={() => setExclusionOffset(exclusionOffset + 25)}>Next exclusions</button>
  {[exclusions.error, restoreExclusion.error, ruleAction.error].filter(Boolean).map((error, index) => <p role="alert" key={index}>{error?.message}</p>)}
  <h3>Discovery recovery</h3>{failures.data?.map(item => <p key={item.key}>{item.provider}: {item.outcome} · {item.retryAt ? `Retry after ${new Date(item.retryAt).toLocaleString()}` : 'Review required'}. Use Search videos now on the performance after correcting source credentials; content failures require recording review.</p>)}
  <h3>Monitoring rules</h3>{rules.data?.map(rule => <div className="card" key={rule.id}>Rule {rule.id} · {rule.dailyBudget} requests/day · {rule.state}{' '}
    <button onClick={() => ruleAction.mutate({ id: rule.id, state: rule.state === 'active' ? 'paused' : 'active' })}>{rule.state === 'active' ? 'Pause' : 'Resume'}</button>{' '}<button onClick={() => ruleAction.mutate({ id: rule.id, state: 'cancelled' })}>Cancel monitoring</button></div>)}</>;
}
