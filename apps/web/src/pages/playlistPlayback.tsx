import type { LibraryConnector } from '@vidarr/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

// Connectors a playlist can be bound to / pushed to: enabled Plex or Jellyfin
// with a video library chosen (Subsonic has no video playlists).
export function playbackConnectors(connectors: LibraryConnector[] | undefined) {
  return (connectors ?? []).filter((c) => c.enabled && c.type !== 'subsonic' && c.videoLibraryId);
}

export function useDefaultPlaybackLibrary() {
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

export function ScheduleSelect({ value, onChange }: { value: number | null; onChange: (value: number | null) => void }) {
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

