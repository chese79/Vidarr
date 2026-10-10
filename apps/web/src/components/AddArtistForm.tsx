import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

type Match = Awaited<ReturnType<typeof api.artists.searchMusicbrainz>>[number];

export default function AddArtistForm({ onDone }: { onDone: () => void }) {
  const client = useQueryClient();
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [selected, setSelected] = useState<Match | null>(null);
  const [rootFolderId, setRootFolderId] = useState('');
  const [qualityProfileId, setQualityProfileId] = useState('');
  const roots = useQuery({ queryKey: ['rootFolders'], queryFn: api.rootFolders.list });
  const profiles = useQuery({ queryKey: ['qualityProfiles'], queryFn: api.qualityProfiles.list });
  const search = useMutation({
    mutationFn: api.artists.searchMusicbrainz,
    onSuccess: setMatches,
  });
  const add = useMutation({
    mutationFn: () => api.artists.addMusicbrainz({ musicbrainzArtistId: selected!.id, rootFolderId: Number(rootFolderId), qualityProfileId: Number(qualityProfileId) }),
    onSuccess: () => { client.invalidateQueries({ queryKey: ['artists'] }); client.invalidateQueries({ queryKey: ['artistSummary'] }); onDone(); },
  });
  return <div className="card">
    <h3>Search MusicBrainz</h3>
    <p>Choose the artist's MusicBrainz identity. Video sources are collected after addition.</p>
    <form className="form-row" onSubmit={(e) => { e.preventDefault(); if (!query.trim()) return; setSelected(null); setMatches(null); search.mutate(query.trim()); }}>
      <input aria-label="MusicBrainz artist name" placeholder="Artist name" value={query} disabled={add.isPending} onChange={(e) => setQuery(e.target.value)} />
      <button type="submit" disabled={!query.trim() || search.isPending || add.isPending}>{search.isPending ? 'Searching…' : 'Search'}</button>
    </form>
    {search.isError && <p role="alert">{(search.error as Error).message}</p>}
    {matches && <div className="form-row">{matches.map((artist) => <button key={artist.id} type="button" className="secondary" disabled={add.isPending} aria-pressed={selected?.id === artist.id} onClick={() => setSelected(artist)}>
      {artist.name}{artist.disambiguation ? ` — ${artist.disambiguation}` : ''}{artist.country ? ` (${artist.country})` : ''}
    </button>)}{!matches.length && <p>No MusicBrainz matches found. Check the artist name.</p>}</div>}
    {selected && <div className="form-row">
      <select aria-label="Root folder" value={rootFolderId} disabled={add.isPending} onChange={(e) => setRootFolderId(e.target.value)}><option value="">Root folder…</option>{roots.data?.map((root) => <option key={root.id} value={root.id}>{root.path}</option>)}</select>
      <select aria-label="Quality profile" value={qualityProfileId} disabled={add.isPending} onChange={(e) => setQualityProfileId(e.target.value)}><option value="">Quality profile…</option>{profiles.data?.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select>
      <button disabled={!rootFolderId || !qualityProfileId || add.isPending} onClick={() => add.mutate()}>{add.isPending ? 'Adding…' : 'Add Artist'}</button>
    </div>}
    {add.isError && <p role="alert">{(add.error as Error).message}</p>}
  </div>;
}
