import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

export default function CalendarPage() {
  const items = useQuery({ queryKey: ['calendar'], queryFn: api.calendar.list });

  return (
    <div>
      <div className="page-header">
        <h2>Calendar</h2>
      </div>
      <p className="empty-state">
        vidarr only knows a video's release year, not an exact date, so this shows recently added
        monitored videos (newest first) rather than a day-by-day release calendar.
      </p>

      {items.data?.length ? (
        <table>
          <thead>
            <tr>
              <th>Added</th>
              <th>Artist</th>
              <th>Video</th>
              <th>Year</th>
              <th>Has File</th>
            </tr>
          </thead>
          <tbody>
            {items.data.map((item) => (
              <tr key={item.id}>
                <td>{new Date(item.addedAt).toLocaleDateString()}</td>
                <td>{item.artist.name}</td>
                <td>{item.title}</td>
                <td>{item.releaseYear ?? '—'}</td>
                <td>{item.hasFile ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="empty-state">No monitored videos yet.</p>
      )}
    </div>
  );
}
