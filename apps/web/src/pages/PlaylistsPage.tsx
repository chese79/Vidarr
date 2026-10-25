import { ActionButton, ActionForm } from '../components/ButtonFeedback';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useCatalogMode } from '../components/CatalogMode';
import { matchesCatalog } from '../catalogMode';
import VideoThumb from '../components/VideoThumb';
import type { DeletePlaylistResult, LibraryConnector, Playlist, UpdatePlaylist } from '@vidarr/shared-types';
import {
  PlaylistRuleFields,
  draftToFilters,
  emptyRuleDraft,
  parseStoredRules,
  type RuleDraft,
} from './playlistRules';
import { describeSync } from './playlistSyncText';
import { nextPlaylistName } from './playlistNames';

interface Notice {
  kind: 'status' | 'alert';
  text: string;
}

// Connectors a playlist can be bound to / pushed to: enabled Plex or Jellyfin
// with a video library chosen (Subsonic has no video playlists).
function playbackConnectors(connectors: LibraryConnector[] | undefined) {
  return (connectors ?? []).filter((c) => c.enabled && c.type !== 'subsonic' && c.videoLibraryId);
}

function useDefaultPlaybackLibrary() {
  const queryClient = useQueryClient();
  const connectors = useQuery({ queryKey: ['libraryConnectors'], queryFn: api.libraryConnectors.list });
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings.get });
  const options = playbackConnectors(connectors.data);
  const preferred = options.find((c) => c.id === settings.data?.defaultPlaybackConnectorId)?.id ?? options[0]?.id ?? '';
  const save = useMutation({
    mutationFn: (id: number) => api.settings.update({ defaultPlaybackConnectorId: id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  });
  return { preferred, save };
}

function ScheduleSelect({ value, onChange }: { value: number | null; onChange: (value: number | null) => void }) {
  // A schedule set through the API can be any interval; keep it selectable
  // instead of silently showing "Manual" and overwriting it on save.
  const custom = value !== null && value !== 1440 && value !== 10080;
  return (
    <select
      aria-label="Regeneration schedule"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
    >
      <option value="">Manual regeneration</option>
      <option value="1440">Daily</option>
      <option value="10080">Weekly</option>
      {custom && <option value={value}>Every {value} minutes</option>}
    </select>
  );
}

function GeneratePlaylistPanel() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(true);
  const [nameDraft, setName] = useState<string | null>(null);
  const playlists = useQuery({ queryKey: ['playlists'], queryFn: api.playlists.list });
  const name = nameDraft ?? nextPlaylistName(playlists.data ?? []);
  const [smart, setSmart] = useState(false);
  const [regenerateIntervalMinutes, setRegenerateIntervalMinutes] = useState<number | null>(null);
  const [targetConnectorId, setTargetConnectorId] = useState<number | ''>('');
  const [sortMode, setSortMode] = useState<'artist_title' | 'shuffle'>('shuffle');
  const [searchParams] = useSearchParams();
  const [draft, setDraft] = useState<RuleDraft>(() => ({ ...emptyRuleDraft(),
    enableGenre: Boolean(searchParams.get('genre')?.trim()), genre: searchParams.get('genre')?.trim() ?? '' }));
  const [result, setResult] = useState<string | null>(null);
  const [maxVideos, setMaxVideos] = useState<number | ''>(20);
  const defaults = useDefaultPlaybackLibrary();
  const [libraryChosen, setLibraryChosen] = useState(false);
  useEffect(() => { if (!libraryChosen) setTargetConnectorId(defaults.preferred); }, [defaults.preferred, libraryChosen]);

  const connectors = useQuery({ queryKey: ['libraryConnectors'], queryFn: api.libraryConnectors.list, enabled: open });

  const generate = useMutation({
    mutationFn: async () => {
      const resolvedName = nameDraft === null ? nextPlaylistName(await api.playlists.list()) : name.trim();
      const result = await api.playlists.generate({
      name: resolvedName,
      filters: draftToFilters(draft),
      matchMode: draft.matchMode,
      smart,
      regenerateIntervalMinutes,
      targetConnectorId: targetConnectorId || null,
      sortMode,
      maxVideos: maxVideos || 20,
      });
      return { ...result, name: resolvedName };
    },
    onSuccess: (r) => {
      setResult([`Created "${r.name}" with ${r.matchedCount} video(s). Review it below, then Push to your playback library to publish it.`, describeSync(r.sync)].filter(Boolean).join(' '));
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      setName(null);
    },
    onError: (err) => setResult(`Failed: ${(err as Error).message}`),
  });


  function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !maxVideos) return;
    generate.mutate();
  }

  return (
    <>
    <div className="form-row playlist-top-actions">
      <ActionButton type="submit" form="playlist-generator" disabled={!name.trim() || !maxVideos || generate.isPending || playlists.isPending || playlists.isError}>
        {generate.isPending ? 'Generating…' : 'Generate playlist'}
      </ActionButton>
      <PlaylistPushAction generatedId={generate.data?.playlistId} busy={generate.isPending} />
    </div>
    <ActionForm className="card" id="playlist-generator" onSubmit={handleGenerate}>
      <div className="page-header" style={{ marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Generate playlist from filters</h3>
        <ActionButton type="button" className="secondary" onClick={() => setOpen(value => !value)} aria-expanded={open}>
          {open ? 'Hide filters' : 'Show filters'}
        </ActionButton>
      </div>

      <div hidden={!open}>
      <div className="form-row">
        <input
          placeholder="Playlist name"
          aria-label="Playlist name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ minWidth: 220 }}
          required
        />
        <label>Videos to add <input type="number" min={1} max={10000} required aria-label="Videos to add" value={maxVideos} onChange={(e) => setMaxVideos(e.target.value ? Number(e.target.value) : '')} style={{ width: 90 }} /></label>
        <label><input type="checkbox" checked={draft.onlyUnwatched} onChange={(e) => setDraft({ ...draft, onlyUnwatched: e.target.checked })} /> Only add unwatched videos</label>
        <select aria-label="Playback library" value={targetConnectorId} onChange={(e) => { setLibraryChosen(true); setTargetConnectorId(e.target.value ? Number(e.target.value) : ''); }}>
          <option value="">Any playback library</option>
          {playbackConnectors(connectors.data).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div className="form-row">
        <ActionButton type="button" className="secondary" disabled={!targetConnectorId || defaults.save.isPending} onClick={() => targetConnectorId && defaults.save.mutate(targetConnectorId)}>Use as default playback library</ActionButton>
        {defaults.save.isSuccess && <span role="status">Default playback library saved.</span>}
        {defaults.save.isError && <span role="alert">{(defaults.save.error as Error).message}</span>}
      </div>
      <div className="form-row" style={{ alignItems: 'center' }}>
        <label>Order <select aria-label="Playlist order" value={sortMode} onChange={(e) => setSortMode(e.target.value as 'artist_title' | 'shuffle')}>
          <option value="artist_title">Artist and title</option>
          <option value="shuffle">Shuffle once</option>
        </select></label>
        <label><input type="checkbox" checked={smart} onChange={(e) => setSmart(e.target.checked)} /> Save as smart playlist</label>
        {smart && <ScheduleSelect value={regenerateIntervalMinutes} onChange={setRegenerateIntervalMinutes} />}
      </div>
      <p className="empty-state">Generate saves the playlist in Vidarr. Open it and Push to your playback library to publish it.{smart && ' Later membership changes republish to that library automatically.'}</p>
      {generate.isPending && <p role="status">Refreshing the playback library and finding matching videos…</p>}

      <PlaylistRuleFields draft={draft} onChange={setDraft} targetConnectorId={targetConnectorId || null} idPrefix="generate" />

      </div>
      {result && (
        <p className="empty-state" role={generate.isError ? 'alert' : 'status'}>
          {result}
        </p>
      )}
    </ActionForm>
    </>
  );
}

function PlaylistPushAction({ generatedId, busy = false }: { generatedId?: number; busy?: boolean }) {
  const client = useQueryClient();
  const { mode } = useCatalogMode();
  const playlists = useQuery({ queryKey: ['playlists'], queryFn: api.playlists.list });
  const connectors = useQuery({ queryKey: ['libraryConnectors'], queryFn: api.libraryConnectors.list });
  const defaults = useDefaultPlaybackLibrary();
  const [selectedId, setSelectedId] = useState<number>();
  const [connectorId, setConnectorId] = useState<number>();
  useEffect(() => { if (generatedId) setSelectedId(generatedId); }, [generatedId]);
  const choices = (playlists.data ?? []).filter(p => !p.items.length || p.items.some(item => matchesCatalog(mode, item)));
  const playlist = selectedId ? choices.find(p => p.id === selectedId) : choices[0];
  const targetId = playlist?.targetConnectorId ?? connectorId ?? defaults.preferred;
  const target = playbackConnectors(connectors.data).find(c => c.id === targetId);
  const push = useMutation({
    mutationFn: () => api.playlists.push(playlist!.id, target!.id),
    onSuccess: () => client.invalidateQueries({ queryKey: ['playlists'] }),
  });
  return <>
    <ActionButton type="button" className="secondary" disabled={!playlist || !target || busy || push.isPending || playlists.isError}
      onClick={() => push.mutate()}>{push.isPending ? 'Pushing…' : `Push to ${target?.name ?? 'media server'}`}</ActionButton>
    <select aria-label="Playlist to push" value={playlist?.id ?? ''} disabled={!choices.length || busy || push.isPending}
      onChange={event => { setSelectedId(Number(event.target.value)); push.reset(); }}>
      <option value="">{choices.length ? 'Select playlist' : 'No playlist exists'}</option>
      {choices.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
    <select aria-label="Media server for playlist push" value={target?.id ?? ''} disabled={Boolean(playlist?.targetConnectorId) || busy || push.isPending}
      onChange={event => { setConnectorId(Number(event.target.value)); push.reset(); }}>
      <option value="">Choose media server</option>
      {playbackConnectors(connectors.data).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
    {push.isSuccess && <span role="status">{push.data.unmatchedTitles.length ? `Published ${push.data.matchedCount} items; ${push.data.unmatchedTitles.length} were not found in the server library.` : `Published ${push.data.matchedCount} items.`}</span>}
    {push.isError && <span role="alert">Push failed: {push.error.message}</span>}
  </>;
}

function PlaylistEditPanel({ playlist, connectors, onClose, onSaved }: {
  playlist: Playlist;
  connectors: LibraryConnector[] | undefined;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const isSmart = playlist.kind === 'smart';
  const [replaceVideos, setReplaceVideos] = useState(false);
  const editRules = isSmart || replaceVideos;
  const [maxVideos, setMaxVideos] = useState<number | ''>(playlist.maxVideos ?? '');
  const original = parseStoredRules(playlist.ruleFilters, playlist.ruleMatchMode);

  const [name, setName] = useState(playlist.name);
  const [targetConnectorId, setTargetConnectorId] = useState<number | ''>(playlist.targetConnectorId ?? '');
  const [sortMode, setSortMode] = useState(playlist.sortMode);
  const [interval, setInterval] = useState(playlist.regenerateIntervalMinutes);
  const [draft, setDraft] = useState<RuleDraft>(original);

  // Send only what changed: a rename shouldn't re-run (and possibly republish)
  // the rules, and the server treats each field it receives as an edit.
  function buildPatch(): UpdatePlaylist {
    const patch: UpdatePlaylist = {};
    if (name.trim() !== playlist.name) patch.name = name.trim();
    const target = targetConnectorId === '' ? null : targetConnectorId;
    if (target !== playlist.targetConnectorId) patch.targetConnectorId = target;
    if (editRules) {
      if (!isSmart) { patch.replaceFromFilters = true; patch.filters = draftToFilters(draft); patch.matchMode = draft.matchMode; }
      if (maxVideos !== (playlist.maxVideos ?? '') || !isSmart) patch.maxVideos = maxVideos || (isSmart ? null : 20);
      const filters = draftToFilters(draft);
      if (JSON.stringify(filters) !== JSON.stringify(draftToFilters(original))) patch.filters = filters;
      if (draft.matchMode !== original.matchMode) patch.matchMode = draft.matchMode;
      if (sortMode !== playlist.sortMode) patch.sortMode = sortMode;
      if (isSmart && interval !== playlist.regenerateIntervalMinutes) patch.regenerateIntervalMinutes = interval;
    }
    return patch;
  }

  const save = useMutation({
    mutationFn: (patch: UpdatePlaylist) => api.playlists.update(playlist.id, patch),
    onSuccess: (_updated, patch) => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      const published = playlist.syncs.filter((s) => s.remotePlaylistId).map((s) => s.connectorName);
      onSaved(patch.name && published.length
        ? `Saved. Push again to rename it on ${published.join(', ')}.`
        : 'Saved.');
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const patch = buildPatch();
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    save.mutate(patch);
  }

  const options = playbackConnectors(connectors);
  const current = connectors?.find((c) => c.id === playlist.targetConnectorId);

  return (
    <ActionForm className="card" aria-label={`Edit playlist ${playlist.name}`} onSubmit={handleSubmit}>
      <div className="form-row">
        <input
          aria-label="Playlist name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ minWidth: 220 }}
          required
        />
        <label>Videos to add <input type="number" min={1} max={10000} placeholder="Unlimited" disabled={!editRules} aria-label="Videos to add" value={maxVideos} onChange={(e) => setMaxVideos(e.target.value ? Number(e.target.value) : '')} style={{ width: 90 }} /></label>
        <label><input type="checkbox" disabled={!editRules} checked={draft.onlyUnwatched} onChange={(e) => setDraft({ ...draft, onlyUnwatched: e.target.checked })} /> Only add unwatched videos</label>
        <select
          aria-label="Playback library"
          value={targetConnectorId}
          onChange={(e) => setTargetConnectorId(e.target.value ? Number(e.target.value) : '')}
        >
          <option value="">Any playback library</option>
          {current && !options.some((c) => c.id === current.id) && <option value={current.id}>{current.name} (unavailable)</option>}
          {options.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {!isSmart && <label><input type="checkbox" checked={replaceVideos} onChange={(e) => setReplaceVideos(e.target.checked)} /> Replace videos from filters</label>}
      {editRules && (
        <>
          <div className="form-row" style={{ alignItems: 'center' }}>
            <label>Order <select aria-label="Playlist order" value={sortMode} onChange={(e) => setSortMode(e.target.value as typeof sortMode)}>
              <option value="artist_title">Artist and title</option>
              <option value="shuffle">Shuffle once</option>
            </select></label>
            {isSmart && <ScheduleSelect value={interval} onChange={setInterval} />}
          </div>
          <PlaylistRuleFields draft={draft} onChange={setDraft} targetConnectorId={targetConnectorId || null} idPrefix={`edit-${playlist.id}`} />
          <p className="empty-state">Saving re-runs these rules now{playlist.syncs.some((s) => s.remotePlaylistId) ? ' and republishes the playlist if its videos changed' : ''}.</p>
        </>
      )}

      <div className="form-row">
        <ActionButton type="submit" disabled={save.isPending || !name.trim()}>
          {save.isPending ? 'Saving…' : 'Save changes'}
        </ActionButton>
        <ActionButton type="button" className="secondary" onClick={onClose}>Cancel</ActionButton>
      </div>
      {save.isError && <p className="empty-state" role="alert">Could not save: {(save.error as Error).message}</p>}
    </ActionForm>
  );
}

function PlaylistCard({ playlistId, onDeleted }: {
  playlistId: number;
  onDeleted: (name: string, result: DeletePlaylistResult, keptRemote: boolean) => void;
}) {
  const { mode } = useCatalogMode();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pushStatus, setPushStatus] = useState<Record<number, string>>({});

  const playlists = useQuery({ queryKey: ['playlists'], queryFn: api.playlists.list });
  const playlist = playlists.data?.find((p) => p.id === playlistId);

  const downloaded = useQuery({
    queryKey: ['musicVideos', 'playable', playlist?.targetConnectorId],
    queryFn: () => api.musicVideos.list(playlist?.targetConnectorId
      ? { playableConnectorId: playlist.targetConnectorId }
      : { playable: true }),
    enabled: adding,
  });

  const connectors = useQuery({ queryKey: ['libraryConnectors'], queryFn: api.libraryConnectors.list });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['playlists'] });

  const addItem = useMutation({
    mutationFn: (musicVideoId: number) => api.playlists.addItem(playlistId, musicVideoId),
    onSuccess: invalidate,
  });
  const removeLiveItem = useMutation({ mutationFn: (id: number) => api.live.action(`playlist-items/${id}/remove`, {}), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['playlists'] }) });
  const removeItem = useMutation({
    mutationFn: (musicVideoId: number) => api.playlists.removeItem(playlistId, musicVideoId),
    onSuccess: invalidate,
  });
  const reorder = useMutation({
    mutationFn: (musicVideoIds: number[]) => api.playlists.sequence(playlistId, musicVideoIds),
    onError: (err) => setNotice({ kind: 'alert', text: `Could not reorder: ${(err as Error).message}` }),
    // Refetch on failure too: a 409 means the server's list differs from ours.
    onSettled: invalidate,
  });
  const removePlaylist = useMutation({
    mutationFn: (keepRemote: boolean) => api.playlists.remove(playlistId, { keepRemote }),
    onSuccess: (result, keepRemote) => {
      invalidate();
      onDeleted(playlist?.name ?? 'Playlist', result, keepRemote);
    },
    onError: (err) => setNotice({ kind: 'alert', text: `Could not delete: ${(err as Error).message}` }),
  });
  const regenerate = useMutation({
    mutationFn: () => api.playlists.regenerate(playlistId),
    onSuccess: (result) => {
      invalidate();
      const sync = describeSync(result.sync);
      setNotice(sync ? { kind: result.sync?.some((r) => r.status === 'failed') ? 'alert' : 'status', text: sync } : null);
    },
  });

  async function handlePush(connectorId: number) {
    // Clears a lingering "Push again to rename it" notice: pushing is exactly
    // what it asked for, so leaving it up would be stale the moment this runs.
    setNotice(null);
    setPushStatus((s) => ({ ...s, [connectorId]: 'Pushing…' }));
    try {
      const result = await api.playlists.push(playlistId, connectorId);
      setPushStatus((s) => ({
        ...s,
        [connectorId]: result.unmatchedTitles.length
          ? `Pushed — ${result.matchedCount} matched, ${result.unmatchedTitles.length} not found: ${result.unmatchedTitles.join(', ')}`
          : `Pushed — ${result.matchedCount} video(s)`,
      }));
    } catch (err) {
      setPushStatus((s) => ({ ...s, [connectorId]: `Failed: ${(err as Error).message}` }));
    }
    invalidate();
  }

  async function handleUnpublish(connectorId: number) {
    setNotice(null);
    setPushStatus((s) => ({ ...s, [connectorId]: 'Removing…' }));
    try {
      await api.playlists.unpublish(playlistId, connectorId);
      setPushStatus((s) => ({ ...s, [connectorId]: 'Removed from this library.' }));
    } catch (err) {
      setPushStatus((s) => ({ ...s, [connectorId]: `Failed: ${(err as Error).message}` }));
    }
    invalidate();
  }

  if (!playlist) return null;
  const inPlaylist = new Set(playlist.items.map((i) => i.musicVideoId));
  const isStatic = playlist.kind === 'static';
  const orderedIds = playlist.items.map((i) => i.id);
  const published = playlist.syncs.filter((s) => s.remotePlaylistId);
  const publishedNames = published.map((s) => s.connectorName).join(', ');

  // Every library this playlist can be pushed to, plus any it is already
  // published to even if it can no longer be pushed there (connector disabled
  // since) — the user must still be able to take that copy down.
  const pushable = (connectors.data ?? []).filter((c) => c.enabled && c.type !== 'subsonic'
    && (!playlist.targetConnectorId || c.id === playlist.targetConnectorId));
  const rows = [
    ...pushable.map((c) => ({ id: c.id, name: c.name, canPush: true, hasLibrary: Boolean(c.videoLibraryId) })),
    ...playlist.syncs
      .filter((s) => !pushable.some((c) => c.id === s.connectorId))
      .map((s) => ({ id: s.connectorId, name: s.connectorName, canPush: false, hasLibrary: false })),
  ];

  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= orderedIds.length) return;
    const next = [...orderedIds];
    [next[index], next[target]] = [next[target], next[index]];
    setNotice(null);
    reorder.mutate(next);
  }

  return (
    <div className="card">
      <div className="page-header" style={{ marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>{playlist.name}{playlist.kind === 'smart' ? ' · Smart' : ''}</h3>
        <div style={{ display: 'flex', gap: 6 }}>
          {playlist.kind === 'smart' && <ActionButton className="secondary" onClick={() => regenerate.mutate()} disabled={regenerate.isPending}>
            {regenerate.isPending ? 'Regenerating…' : 'Regenerate'}
          </ActionButton>}
          <ActionButton
            className="secondary"
            aria-expanded={editing}
            aria-label={`Edit playlist ${playlist.name}`}
            onClick={() => { setEditing((v) => !v); setNotice(null); }}
          >
            {editing ? 'Close editor' : 'Edit'}
          </ActionButton>
          {isStatic && mode !== 'live' && <ActionButton
            className="secondary"
            aria-expanded={adding}
            aria-controls={`playlist-${playlistId}-add-videos`}
            onClick={() => setAdding((v) => !v)}
          >
            {adding ? 'Done adding' : 'Add videos'}
          </ActionButton>}
          <ActionButton
            className="secondary"
            aria-label={`Delete playlist ${playlist.name}`}
            aria-expanded={confirmingDelete}
            onClick={() => setConfirmingDelete((v) => !v)}
          >
            Delete playlist
          </ActionButton>
        </div>
      </div>

      {notice && <p className="empty-state" role={notice.kind === 'alert' ? 'alert' : 'status'}>{notice.text}</p>}

      {confirmingDelete && (
        <div className="card" role="group" aria-label={`Confirm deleting ${playlist.name}`}>
          <p style={{ margin: '0 0 8px' }}>
            Delete “{playlist.name}”?
            {published.length > 0 && ` It is published to ${publishedNames}; deleting also removes it there.`}
          </p>
          <div className="form-row">
            <ActionButton onClick={() => removePlaylist.mutate(false)} disabled={removePlaylist.isPending}>
              {removePlaylist.isPending ? 'Deleting…' : 'Delete playlist'}
            </ActionButton>
            {published.length > 0 && (
              <ActionButton className="secondary" onClick={() => removePlaylist.mutate(true)} disabled={removePlaylist.isPending}>
                Delete, keep it on {publishedNames}
              </ActionButton>
            )}
            <ActionButton className="secondary" onClick={() => setConfirmingDelete(false)}>Cancel</ActionButton>
          </div>
        </div>
      )}

      {editing && (
        <PlaylistEditPanel
          playlist={playlist}
          connectors={connectors.data}
          onClose={() => setEditing(false)}
          onSaved={(text) => { setEditing(false); setNotice({ kind: 'status', text }); }}
        />
      )}

      {playlist.kind === 'smart' && <p className="empty-state" style={{ padding: '0 0 8px' }}>
        {playlist.regenerateIntervalMinutes === 1440 ? 'Regenerates daily'
          : playlist.regenerateIntervalMinutes === 10080 ? 'Regenerates weekly'
          : playlist.regenerateIntervalMinutes ? `Regenerates every ${playlist.regenerateIntervalMinutes} minutes`
          : 'Regenerates manually'}
      </p>}
      {playlist.targetConnectorId && <p className="empty-state" style={{ padding: '0 0 8px' }}>
        Playback library: {connectors.data?.find((c) => c.id === playlist.targetConnectorId)?.name ?? `Connector ${playlist.targetConnectorId}`}
      </p>}
      {playlist.sortMode === 'shuffle' && <p className="empty-state" style={{ padding: '0 0 8px' }}>Shuffled order is kept when this playlist regenerates.</p>}

      {mode !== 'both' && playlist.items.some(item => !matchesCatalog(mode, item)) && <p role="status">Only matching items are shown. Push and playlist-wide actions include the complete saved playlist. Select Both to reorder all items.</p>}
      {playlist.items.some(item => matchesCatalog(mode, item)) ? (
        <div className="video-list">
          {playlist.items.map((item, index) => matchesCatalog(mode, item) && (
            <div className="video-row" key={item.id}>
              <span aria-hidden="true" className="empty-state" style={{ padding: 0, minWidth: 24, textAlign: 'right' }}>{index + 1}</span>
              <VideoThumb url={item.musicVideo?.thumbnailUrl ?? null} />
              <div className="video-info">
                <strong>{(item.musicVideo?.title ?? item.recordingPart?.recording.title ?? 'Recording')}</strong>
                <span className="empty-state" style={{ padding: 0 }}>
                  {item.musicVideo?.artist.name ?? 'Live recording'}
                </span>
              </div>
              <div className="video-actions">
                {isStatic && <>
                  <ActionButton
                    className="secondary"
                    aria-label={`Move ${(item.musicVideo?.title ?? item.recordingPart?.recording.title ?? 'Recording')} up`}
                    disabled={mode !== 'both' && playlist.items.some(item => !matchesCatalog(mode, item)) || index === 0 || reorder.isPending}
                    onClick={() => move(index, -1)}
                  >
                    ↑
                  </ActionButton>
                  <ActionButton
                    className="secondary"
                    aria-label={`Move ${(item.musicVideo?.title ?? item.recordingPart?.recording.title ?? 'Recording')} down`}
                    disabled={mode !== 'both' && playlist.items.some(item => !matchesCatalog(mode, item)) || index === playlist.items.length - 1 || reorder.isPending}
                    onClick={() => move(index, 1)}
                  >
                    ↓
                  </ActionButton>
                  <ActionButton
                    className="secondary"
                    aria-label={`Remove ${(item.musicVideo?.title ?? item.recordingPart?.recording.title ?? 'Recording')} from playlist`}
                    onClick={() => item.musicVideoId ? removeItem.mutate(item.musicVideoId) : removeLiveItem.mutate(item.id)}
                  >
                    Remove
                  </ActionButton>
                </>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-state">No videos in this playlist yet.</p>
      )}

      {adding && mode !== 'live' && (
        <div className="video-list" id={`playlist-${playlistId}-add-videos`} style={{ marginTop: 8 }}>
          {(downloaded.data ?? [])
            .filter((v) => !inPlaylist.has(v.id))
            .map((v) => (
              <div className="video-row" key={v.id}>
                <div className="video-info">
                  <strong>{v.title}</strong>
                  <span className="empty-state" style={{ padding: 0 }}>
                    {v.artist.name}
                  </span>
                </div>
                <div className="video-actions">
                  <ActionButton aria-label={`Add ${v.title} to playlist`} onClick={() => addItem.mutate(v.id)}>
                    Add
                  </ActionButton>
                </div>
              </div>
            ))}
          {downloaded.data?.length === 0 && <p className="empty-state">No local or media-server videos available yet.</p>}
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <p className="empty-state" style={{ padding: '0 0 6px' }}>
            Push to library:
          </p>
          {rows.map((row) => {
            const sync = playlist.syncs.find((s) => s.connectorId === row.id);
            const isPublished = Boolean(sync?.remotePlaylistId);
            return (
              <div className="form-row" key={row.id} style={{ alignItems: 'center' }}>
                {row.canPush
                  ? <ActionButton className="secondary" onClick={() => handlePush(row.id)} disabled={!row.hasLibrary}>
                    {isPublished ? `Update on ${row.name}` : `Push to ${row.name}`}
                  </ActionButton>
                  : <span>{row.name}</span>}
                {isPublished && (
                  <ActionButton className="secondary" aria-label={`Remove playlist from ${row.name}`} onClick={() => handleUnpublish(row.id)}>
                    Remove from {row.name}
                  </ActionButton>
                )}
                {row.canPush && !row.hasLibrary && (
                  <span className="empty-state" style={{ padding: 0, fontSize: 12 }}>
                    Pick a video library for this connector first.
                  </span>
                )}
                <span className="empty-state" style={{ padding: 0 }} role="status">
                  {pushStatus[row.id] ?? (sync
                    ? `Last: ${sync.lastPushStatus} (${sync.lastPushedAt})${sync.lastPushStatus === 'failed' && sync.lastPushError ? ` — ${sync.lastPushError}` : ''}`
                    : '—')}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function PlaylistsPage() {
  const { mode, setMode } = useCatalogMode();
  const queryClient = useQueryClient();
  const [nameDraft, setName] = useState<string | null>(null);
  const [targetConnectorId, setTargetConnectorId] = useState<number | ''>('');
  const defaults = useDefaultPlaybackLibrary();
  const [libraryChosen, setLibraryChosen] = useState(false);
  useEffect(() => { if (!libraryChosen) setTargetConnectorId(defaults.preferred); }, [defaults.preferred, libraryChosen]);
  const [notice, setNotice] = useState<Notice | null>(null);

  const playlists = useQuery({ queryKey: ['playlists'], queryFn: api.playlists.list });
  const name = nameDraft ?? nextPlaylistName(playlists.data ?? []);
  const connectors = useQuery({ queryKey: ['libraryConnectors'], queryFn: api.libraryConnectors.list });

  const createPlaylist = useMutation({
    mutationFn: api.playlists.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      setName(null);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    createPlaylist.mutate({ name, targetConnectorId: targetConnectorId || null });
  }

  // Lives here, not on the card: the card is gone once its playlist is deleted,
  // but a copy that couldn't be removed from a media server still needs saying.
  function handleDeleted(deletedName: string, result: DeletePlaylistResult, keptRemote: boolean) {
    if (result.failedRemote.length) {
      const failures = result.failedRemote.map((f) => `${f.connectorName} (${f.error})`).join('; ');
      setNotice({ kind: 'alert', text: `Deleted “${deletedName}”, but it could not be removed from ${failures}. Remove it there manually.` });
    } else if (result.removedRemote) {
      setNotice({ kind: 'status', text: `Deleted “${deletedName}” and removed it from ${result.removedRemote} media server(s).` });
    } else {
      setNotice({ kind: 'status', text: keptRemote ? `Deleted “${deletedName}”. Its published copies were left in place.` : `Deleted “${deletedName}”.` });
    }
  }

  return (
    <div>
      <div className="page-header">
        <h2>Playlists</h2>
      </div>

      {notice && <p className="empty-state" role={notice.kind === 'alert' ? 'alert' : 'status'}>{notice.text}</p>}

      {mode !== 'live' && <GeneratePlaylistPanel />}
      {mode === 'live' && <><div className="form-row playlist-top-actions"><ActionButton onClick={() => setMode('musicVideos')}>Generate music-video playlist</ActionButton><PlaylistPushAction /></div><p>Add reviewed Live &amp; Concerts recordings to a static playlist from their recording pages. Automatic filter generation is available for Music Videos; the button switches to that generator.</p></>}
      <details style={{ marginTop: 16, marginBottom: 16 }}><summary>Create an empty playlist manually</summary>
      <ActionForm className="form-row" onSubmit={handleSubmit}>
        <input
          placeholder="Playlist name"
          aria-label="Playlist name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ minWidth: 240 }}
          required
        />
        <select aria-label="Playlist playback library" value={targetConnectorId} onChange={(e) => { setLibraryChosen(true); setTargetConnectorId(e.target.value ? Number(e.target.value) : ''); }}>
          <option value="">Any playback library</option>
          {playbackConnectors(connectors.data).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <ActionButton type="submit">Create Playlist</ActionButton>
      </ActionForm>

      </details>

      {playlists.isPending ? <p role="status">Loading playlists…</p> : playlists.isError ? <p role="alert">Unable to load playlists: {playlists.error.message}</p> : playlists.data?.length ? (
        <>
        {!playlists.data.some(p => !p.items.length || p.items.some(item => matchesCatalog(mode, item))) && <p role="status">Your saved playlists are hidden by the current media filter. <ActionButton className="secondary" onClick={() => setMode('both')}>Show all playlists</ActionButton></p>}
        {
        playlists.data.filter(p => !p.items.length || p.items.some(item => matchesCatalog(mode, item))).map((p) => <PlaylistCard key={p.id} playlistId={p.id} onDeleted={handleDeleted} />)
        }
        </>
      ) : (
        <p className="empty-state">No playlists yet.</p>
      )}
    </div>
  );
}
