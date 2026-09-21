import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

// candidateRejected/candidateHeldForReview (Phase 3) are the only event
// types that currently carry a `reason` worth surfacing — everything else's
// `data` blob is either empty or not meant for a user-facing summary, so
// this deliberately only unpacks what it recognizes rather than dumping raw
// JSON for every row.
function reasonFor(eventType: string, data: string | null): string | null {
  if (eventType !== 'candidateRejected' && eventType !== 'candidateHeldForReview') return null;
  if (!data) return null;
  try {
    const parsed = JSON.parse(data) as { reason?: string };
    return parsed.reason ?? null;
  } catch {
    return null;
  }
}

export default function HistoryPage() {
  const history = useQuery({ queryKey: ['history'], queryFn: api.history.list });

  return (
    <div>
      <div className="page-header">
        <h2>History</h2>
      </div>

      {history.data?.length ? (
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Artist</th>
              <th>Video</th>
              <th>Event</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {history.data.map((h) => (
              <tr key={h.id}>
                <td>{new Date(h.date).toLocaleString()}</td>
                <td>{h.musicVideo.artist.name}</td>
                <td>{h.musicVideo.title}</td>
                <td>{h.eventType}</td>
                <td className="empty-state">{reasonFor(h.eventType, h.data) ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="empty-state">No history yet.</p>
      )}
    </div>
  );
}
