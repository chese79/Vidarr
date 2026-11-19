import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Playlist, LibraryConnector, UpdatePlaylist } from '@vidarr/shared-types';
import { api } from '../api/client';
import { ActionButton, ActionForm } from '../components/ButtonFeedback';
import { PlaylistRuleFields, draftToFilters, emptyRuleDraft, parseStoredRules, type RuleDraft } from './playlistRules';
import { playbackConnectors, ScheduleSelect } from './playlistPlayback';

export default function PlaylistEditPanel({ playlist, connectors, onClose, onSaved }: {
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

