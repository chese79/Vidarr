import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

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
            </tr>
          </thead>
          <tbody>
            {history.data.map((h) => (
              <tr key={h.id}>
                <td>{new Date(h.date).toLocaleString()}</td>
                <td>{h.musicVideo.artist.name}</td>
                <td>{h.musicVideo.title}</td>
                <td>{h.eventType}</td>
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
