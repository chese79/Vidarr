import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { TransferMode } from '@vidarr/shared-types';

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings.get });
  const [namingFormat, setNamingFormat] = useState('');
  const [transferMode, setTransferMode] = useState<TransferMode>('hardlink');
  const [minFreeSpaceMb, setMinFreeSpaceMb] = useState(1024);

  useEffect(() => {
    if (settings.data) {
      setNamingFormat(settings.data.namingFormat);
      setTransferMode(settings.data.transferMode);
      setMinFreeSpaceMb(settings.data.minFreeSpaceMb);
    }
  }, [settings.data]);

  const update = useMutation({
    mutationFn: api.settings.update,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  });

  return (
    <div>
      <div className="page-header">
        <h2>Settings</h2>
      </div>

      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          update.mutate({ namingFormat, transferMode, minFreeSpaceMb });
        }}
      >
        <div className="form-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <label>Naming format</label>
          <input value={namingFormat} onChange={(e) => setNamingFormat(e.target.value)} />
        </div>
        <div className="form-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <label>Transfer mode</label>
          <select
            value={transferMode}
            onChange={(e) => setTransferMode(e.target.value as TransferMode)}
          >
            <option value="hardlink">Hardlink</option>
            <option value="copy">Copy</option>
            <option value="move">Move</option>
          </select>
        </div>
        <div className="form-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <label>Minimum free space (MB)</label>
          <input
            type="number"
            value={minFreeSpaceMb}
            onChange={(e) => setMinFreeSpaceMb(Number(e.target.value))}
          />
        </div>
        <button type="submit">Save</button>
      </form>
    </div>
  );
}
