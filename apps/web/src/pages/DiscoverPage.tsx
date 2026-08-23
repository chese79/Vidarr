import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

const SOURCE_LABEL: Record<string, string> = {
  library: 'Your library',
  lastfm: 'Last.fm',
  spotify: 'Spotify',
  musicbrainz: 'MusicBrainz',
};

export default function DiscoverPage() {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshSummary, setRefreshSummary] = useState<string | null>(null);

  const recommendations = useQuery({
    queryKey: ['recommendations'],
    queryFn: api.recommendations.list,
  });
  const rootFolders = useQuery({ queryKey: ['rootFolders'], queryFn: api.rootFolders.list });
  const qualityProfiles = useQuery({
    queryKey: ['qualityProfiles'],
    queryFn: api.qualityProfiles.list,
  });

  const dismiss = useMutation({
    mutationFn: api.recommendations.dismiss,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recommendations'] }),
  });

  const add = useMutation({
    mutationFn: ({ id }: { id: number }) =>
      api.recommendations.add(id, {
        rootFolderId: rootFolders.data![0].id,
        qualityProfileId: qualityProfiles.data![0].id,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recommendations'] });
      queryClient.invalidateQueries({ queryKey: ['artists'] });
    },
  });

  async function handleRefresh() {
    setRefreshing(true);
    setRefreshSummary(null);
    try {
      const result = await api.recommendations.refresh();
      setRefreshSummary(
        `${result.totalRecommendations} recommendations (${result.newRecommendations} new)`,
      );
      queryClient.invalidateQueries({ queryKey: ['recommendations'] });
    } catch (err) {
      setRefreshSummary(`Refresh failed: ${(err as Error).message}`);
    }
    setRefreshing(false);
  }

  const canAdd = (rootFolders.data?.length ?? 0) > 0 && (qualityProfiles.data?.length ?? 0) > 0;

  return (
    <div>
      <div className="page-header">
        <h2>Discover</h2>
        <button onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? 'Refreshing…' : 'Refresh Recommendations'}
        </button>
      </div>

      {refreshSummary && <p className="empty-state">{refreshSummary}</p>}

      {!canAdd && (
        <p className="empty-state">
          Add a root folder and a quality profile before you can add recommended artists.
        </p>
      )}

      {recommendations.data?.length ? (
        <table>
          <thead>
            <tr>
              <th>Artist</th>
              <th>Score</th>
              <th>Why</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {recommendations.data.map((r) => (
              <tr key={r.id}>
                <td>{r.artistName}</td>
                <td>{r.aggregateScore.toFixed(2)}</td>
                <td>
                  {[...new Set(r.sourceHits.map((h) => SOURCE_LABEL[h.source] ?? h.source))].join(
                    ', ',
                  )}
                </td>
                <td style={{ display: 'flex', gap: 6 }}>
                  <button disabled={!canAdd} onClick={() => add.mutate({ id: r.id })}>
                    Add to Library
                  </button>
                  <button className="secondary" onClick={() => dismiss.mutate(r.id)}>
                    Dismiss
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="empty-state">
          No recommendations yet. Sync a library connector and/or enable a recommendation
          provider in Settings, then click Refresh.
        </p>
      )}
    </div>
  );
}
