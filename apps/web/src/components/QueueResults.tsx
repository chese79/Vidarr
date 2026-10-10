import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { HistoryEntry } from '@vidarr/shared-types';
import { api } from '../api/client';

function details(item: HistoryEntry): string {
  try {
    const data = JSON.parse(item.data ?? '{}');
    const value = item.eventType === 'downloadFailed' ? data.error : data.quality;
    return typeof value === 'string' ? value : '—';
  } catch { return '—'; }
}

export function QueueResultsTable({ items, failed }: { items: HistoryEntry[]; failed: boolean }) {
  return <table><thead><tr><th>Date</th><th>Artist</th><th>Video</th><th>{failed ? 'Error' : 'Quality'}</th></tr></thead>
    <tbody>{items.map(item => <tr key={item.id}>
      <td>{new Date(item.date).toLocaleString()}</td><td>{item.musicVideo.artist.name}</td>
      <td>{item.musicVideo.title}</td><td>{details(item)}</td>
    </tr>)}</tbody></table>;
}

export function RecentQueueResults({ section }: { section: 'completed' | 'failures' }) {
  const results = useQuery({ queryKey: ['queueResults', section, 1, 3],
    queryFn: () => api.queue.results(section, 1, 3), refetchInterval: 3000 });
  return <section aria-label={section === 'completed' ? 'Recently completed' : 'Recent failures'} style={{ marginTop: 32 }}>
    <div className="page-header"><h3>{section === 'completed' ? 'Recently completed' : 'Recent failures'}</h3>
      <Link to={`/queue/${section}`}>View all {section}</Link></div>
    {results.isPending ? <p role="status">Loading…</p> : results.isError ? <p role="alert">Could not load {section}.</p> :
      results.data.items.length ? <QueueResultsTable items={results.data.items} failed={section === 'failures'} /> :
        <p className="empty-state">{section === 'completed' ? 'No completed videos yet.' : 'No failures.'}</p>}
  </section>;
}

export function QueueResultsPage({ section }: { section: 'completed' | 'failures' }) {
  const [page, setPage] = useState(1);
  const results = useQuery({ queryKey: ['queueResults', section, page, 50],
    queryFn: () => api.queue.results(section, page, 50), refetchInterval: 3000 });
  return <div><div className="page-header"><h2>{section === 'completed' ? 'Completed videos' : 'Download failures'}</h2>
    <Link to="/queue">Back to Queue</Link></div>
    {results.isPending ? <p role="status">Loading…</p> : results.isError ? <p role="alert">Could not load {section}.</p> : <>
      {results.data.items.length ? <QueueResultsTable items={results.data.items} failed={section === 'failures'} /> :
        <p className="empty-state">No {section} on this page.</p>}
      <div className="form-row" style={{ marginTop: 16 }}>
        <button className="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>
        <span>Page {page} · {results.data.total} results</span>
        <button className="secondary" disabled={page * 50 >= results.data.total} onClick={() => setPage(page + 1)}>Next</button>
      </div>
    </>}
  </div>;
}
