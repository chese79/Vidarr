import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { PlaylistImportCandidate, ImportSelection } from '@vidarr/shared-types';

type RowAction = 'skip' | 'assign' | 'create';
interface RowState {
  action: RowAction;
  artistId?: number;
}

function initialRowState(candidate: PlaylistImportCandidate): RowState {
  if (candidate.alreadyInLibrary) return { action: 'skip' };
  if (candidate.matchedArtistId) return { action: 'assign', artistId: candidate.matchedArtistId };
  return { action: 'create' };
}

export default function ImportPage() {
  const [url, setUrl] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<PlaylistImportCandidate[] | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [rootFolderId, setRootFolderId] = useState<number | ''>('');
  const [qualityProfileId, setQualityProfileId] = useState<number | ''>('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const artists = useQuery({ queryKey: ['artists'], queryFn: api.artists.list });
  const rootFolders = useQuery({ queryKey: ['rootFolders'], queryFn: api.rootFolders.list });
  const qualityProfiles = useQuery({
    queryKey: ['qualityProfiles'],
    queryFn: api.qualityProfiles.list,
  });

  async function handlePreview(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setPreviewing(true);
    setPreviewError(null);
    setResult(null);
    try {
      const found = await api.bulkImport.previewYoutubePlaylist(url.trim());
      setCandidates(found);
      const initial: Record<string, RowState> = {};
      found.forEach((c) => (initial[c.youtubeVideoId] = initialRowState(c)));
      setRows(initial);
    } catch (err) {
      setPreviewError((err as Error).message);
    }
    setPreviewing(false);
  }

  function updateRow(id: string, next: RowState) {
    setRows((r) => ({ ...r, [id]: next }));
  }

  async function handleImport() {
    if (!candidates || rootFolderId === '' || qualityProfileId === '') return;
    setImporting(true);
    setResult(null);
    const selections: ImportSelection[] = candidates.map((c) => {
      const row = rows[c.youtubeVideoId];
      const base = { youtubeVideoId: c.youtubeVideoId, title: c.title, suggestedArtistName: c.suggestedArtistName };
      if (row.action === 'assign' && row.artistId) {
        return { ...base, action: 'assign', artistId: row.artistId };
      }
      if (row.action === 'create') return { ...base, action: 'create' };
      return { ...base, action: 'skip' };
    });
    try {
      const outcome = await api.bulkImport.commitYoutubePlaylist(
        selections,
        Number(rootFolderId),
        Number(qualityProfileId),
      );
      setResult(
        `Added ${outcome.videosAdded} video(s), created ${outcome.artistsCreated} new artist(s), skipped ${outcome.skipped}.`,
      );
      setCandidates(null);
      setUrl('');
    } catch (err) {
      setResult(`Failed: ${(err as Error).message}`);
    }
    setImporting(false);
  }

  const canImport = rootFolderId !== '' && qualityProfileId !== '';

  return (
    <div>
      <div className="page-header">
        <h2>Import</h2>
      </div>

      <div className="card">
        <p className="empty-state" style={{ padding: '0 0 10px' }}>
          Bulk-add videos from a YouTube playlist URL. Each video's artist is guessed from its
          title ("Artist - Title", falling back to the uploading channel when no such pattern is
          found) and matched against your existing artists — review and adjust before importing.
          Videos are added to the wanted list with their exact YouTube video already known, so the
          next backlog search grabs them directly (no heuristic search needed).
        </p>
        <form className="form-row" onSubmit={handlePreview}>
          <input
            placeholder="https://www.youtube.com/playlist?list=..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            style={{ minWidth: 360 }}
            required
          />
          <button type="submit" disabled={previewing}>
            {previewing ? 'Loading…' : 'Preview'}
          </button>
        </form>
        {previewError && <p className="empty-state">{previewError}</p>}
      </div>

      {candidates && (
        <div className="card">
          <div className="form-row">
            <select value={rootFolderId} onChange={(e) => setRootFolderId(Number(e.target.value))} required>
              <option value="">Root folder (for new artists)…</option>
              {rootFolders.data?.map((rf) => (
                <option key={rf.id} value={rf.id}>
                  {rf.path}
                </option>
              ))}
            </select>
            <select
              value={qualityProfileId}
              onChange={(e) => setQualityProfileId(Number(e.target.value))}
              required
            >
              <option value="">Quality profile (for new artists)…</option>
              {qualityProfiles.data?.map((qp) => (
                <option key={qp.id} value={qp.id}>
                  {qp.name}
                </option>
              ))}
            </select>
            <button onClick={handleImport} disabled={!canImport || importing}>
              {importing ? 'Importing…' : `Import Selected (${candidates.length})`}
            </button>
          </div>

          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Suggested Artist</th>
                <th>Channel</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => {
                const row = rows[c.youtubeVideoId];
                return (
                  <tr key={c.youtubeVideoId}>
                    <td>{c.title}</td>
                    <td>{c.suggestedArtistName}</td>
                    <td>{c.channel}</td>
                    <td>
                      <select
                        value={row.action === 'assign' ? `assign:${row.artistId}` : row.action}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === 'skip' || v === 'create') updateRow(c.youtubeVideoId, { action: v });
                          else updateRow(c.youtubeVideoId, { action: 'assign', artistId: Number(v.split(':')[1]) });
                        }}
                      >
                        <option value="skip">Skip{c.alreadyInLibrary ? ' (already in library)' : ''}</option>
                        <option value="create">Create new artist "{c.suggestedArtistName}"</option>
                        {artists.data?.map((a) => (
                          <option key={a.id} value={`assign:${a.id}`}>
                            Assign to {a.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {result && <p className="empty-state">{result}</p>}
    </div>
  );
}
