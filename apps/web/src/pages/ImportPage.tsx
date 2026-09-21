import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { PlaylistImportCandidate, ImportArtistGroup } from '@vidarr/shared-types';

function squash(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

interface GroupState {
  key: string;
  artistId: number | null;
  artistName: string;
  monitor: boolean;
  videos: { youtubeVideoId: string; title: string; include: boolean; alreadyInLibrary: boolean }[];
}

// Groups the flat candidate list by resolved artist (matched existing, or the
// parsed suggested name) so the review UI shows one watch-list checkbox per
// performer instead of repeating it on every video row.
function groupCandidates(candidates: PlaylistImportCandidate[]): GroupState[] {
  const groups = new Map<string, GroupState>();
  for (const c of candidates) {
    const key = c.matchedArtistId ? `id:${c.matchedArtistId}` : `new:${squash(c.suggestedArtistName)}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        artistId: c.matchedArtistId,
        artistName: c.matchedArtistName ?? c.suggestedArtistName,
        monitor: false,
        videos: [],
      });
    }
    groups.get(key)!.videos.push({
      youtubeVideoId: c.youtubeVideoId,
      title: c.title,
      include: !c.alreadyInLibrary,
      alreadyInLibrary: c.alreadyInLibrary,
    });
  }
  return [...groups.values()];
}

export default function ImportPage() {
  const [url, setUrl] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [groups, setGroups] = useState<GroupState[] | null>(null);
  const [rootFolderId, setRootFolderId] = useState<number | ''>('');
  const [qualityProfileId, setQualityProfileId] = useState<number | ''>('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

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
      setGroups(groupCandidates(found));
    } catch (err) {
      setPreviewError((err as Error).message);
    }
    setPreviewing(false);
  }

  function updateGroup(key: string, patch: Partial<GroupState>) {
    setGroups((gs) => gs && gs.map((g) => (g.key === key ? { ...g, ...patch } : g)));
  }

  function updateVideo(groupKey: string, youtubeVideoId: string, include: boolean) {
    setGroups(
      (gs) =>
        gs &&
        gs.map((g) =>
          g.key !== groupKey
            ? g
            : { ...g, videos: g.videos.map((v) => (v.youtubeVideoId === youtubeVideoId ? { ...v, include } : v)) },
        ),
    );
  }

  async function handleImport() {
    if (!groups || rootFolderId === '' || qualityProfileId === '') return;
    setImporting(true);
    setResult(null);
    const payload: ImportArtistGroup[] = groups.map((g) => ({
      artistId: g.artistId,
      artistName: g.artistName,
      monitor: g.monitor,
      videos: g.videos.map((v) => ({ youtubeVideoId: v.youtubeVideoId, title: v.title, include: v.include })),
    }));
    try {
      const outcome = await api.bulkImport.commitYoutubePlaylist(
        payload,
        Number(rootFolderId),
        Number(qualityProfileId),
      );
      setResult(
        `Added ${outcome.videosAdded} video(s), created ${outcome.artistsCreated} new artist(s), skipped ${outcome.skipped}.`,
      );
      setGroups(null);
      setUrl('');
    } catch (err) {
      setResult(`Failed: ${(err as Error).message}`);
    }
    setImporting(false);
  }

  const canImport = rootFolderId !== '' && qualityProfileId !== '';
  const totalVideos = groups?.reduce((n, g) => n + g.videos.length, 0) ?? 0;
  const includedCount = groups?.reduce((n, g) => n + g.videos.filter((v) => v.include).length, 0) ?? 0;

  return (
    <div>
      <div className="page-header">
        <h2>Import</h2>
      </div>

      <div className="card">
        <p className="empty-state" style={{ padding: '0 0 10px' }}>
          Bulk-add videos from a YouTube playlist URL. Each video's artist is guessed from its
          title ("Artist - Title", falling back to the uploading channel when no such pattern is
          found) and grouped below. Videos are included by default; check "Add to watch list" only
          for artists you want vidarr to actively monitor going forward.
        </p>
        <form className="form-row" onSubmit={handlePreview}>
          <input
            placeholder="https://www.youtube.com/playlist?list=..."
            aria-label="YouTube playlist URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            style={{ minWidth: 360 }}
            required
          />
          <button type="submit" disabled={previewing}>
            {previewing ? 'Loading…' : 'Preview'}
          </button>
        </form>
        {previewError && (
          <p className="empty-state" role="alert">
            {previewError}
          </p>
        )}
      </div>

      {groups && (
        <div className="card">
          <div className="form-row">
            <select
              value={rootFolderId}
              aria-label="Root folder for new artists"
              onChange={(e) => setRootFolderId(Number(e.target.value))}
              required
            >
              <option value="">Root folder (for new artists)…</option>
              {rootFolders.data?.map((rf) => (
                <option key={rf.id} value={rf.id}>
                  {rf.path}
                </option>
              ))}
            </select>
            <select
              value={qualityProfileId}
              aria-label="Quality profile for new artists"
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
              {importing ? 'Importing…' : `Import Selected (${includedCount}/${totalVideos})`}
            </button>
          </div>

          {groups.map((g) => (
            // No background override here (was --bg, same as the page itself) —
            // the group's only remaining boundary was the low-contrast .card
            // border, making it indistinguishable from the page background.
            <div key={g.key} className="card">
              <div className="form-row" style={{ alignItems: 'center', marginBottom: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={g.monitor}
                    onChange={(e) => updateGroup(g.key, { monitor: e.target.checked })}
                    aria-label={`Add ${g.artistName} to watch list`}
                  />
                  Add to watch list
                </label>
                <strong>{g.artistName}</strong>
                <span className="empty-state" style={{ padding: 0 }}>
                  {g.artistId ? '(existing artist)' : '(new artist)'}
                </span>
              </div>

              <table>
                <thead>
                  <tr>
                    <th>Include</th>
                    <th>Title</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {g.videos.map((v) => (
                    <tr key={v.youtubeVideoId}>
                      <td style={{ width: 24 }}>
                        <input
                          type="checkbox"
                          checked={v.include}
                          onChange={(e) => updateVideo(g.key, v.youtubeVideoId, e.target.checked)}
                          aria-label={v.title}
                        />
                      </td>
                      <td>{v.title}</td>
                      <td className="empty-state">{v.alreadyInLibrary ? 'already in library' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {result && (
        <p className="empty-state" role="status">
          {result}
        </p>
      )}
    </div>
  );
}
