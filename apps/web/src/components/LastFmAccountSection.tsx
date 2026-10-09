import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

export function LastFmAccountSection() {
  const queryClient = useQueryClient();
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);
  const status = useQuery({ queryKey: ['lastfm'], queryFn: api.lastfm.status, refetchInterval: 15_000 });
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ['lastfm'] }); };
  const start = useMutation({ mutationFn: api.lastfm.startLink, onSuccess: (result) => {
    setAuthorizationUrl(result.authorizationUrl); refresh();
  } });
  const complete = useMutation({ mutationFn: api.lastfm.completeLink, onSuccess: () => {
    setAuthorizationUrl(null); refresh();
  } });
  const toggle = useMutation({ mutationFn: api.lastfm.setScrobbling, onSuccess: refresh });
  const unlink = useMutation({ mutationFn: api.lastfm.unlink, onSuccess: () => {
    setAuthorizationUrl(null); refresh();
  } });
  const busy = start.isPending || complete.isPending || toggle.isPending || unlink.isPending;
  const error = start.error ?? complete.error ?? toggle.error ?? unlink.error ?? status.error;
  const account = status.data;
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Last.fm account &amp; scrobbling</h3>
      <p>Save your Last.fm API key and shared secret above, then authorize Vidarr on Last.fm.</p>
      <p>Playback from <strong>all users</strong> in every enabled Jellyfin or Plex connector’s selected
        music-video library goes to this one account. Other libraries and historical play counts are excluded.</p>
      {account?.linked && <p>Linked to <strong>{account.username}</strong>.</p>}
      <div className="form-row">
        <button type="button" disabled={busy} onClick={() => start.mutate()}>
          {start.isPending ? 'Starting…' : account?.linked ? 'Link another account' : 'Link account'}
        </button>
        {authorizationUrl && <a href={authorizationUrl} target="_blank" rel="noopener noreferrer">Authorize on Last.fm ↗</a>}
        {account?.pendingAuthorization && <button type="button" disabled={busy} onClick={() => complete.mutate()}>
          Complete link after authorizing
        </button>}
        {account?.linked && <button type="button" disabled={busy} onClick={() => unlink.mutate()}>Unlink account</button>}
      </div>
      {account?.linked && <label>
        <input type="checkbox" checked={account.scrobblingEnabled} disabled={busy}
          onChange={(event) => toggle.mutate(event.target.checked)} />{' '}
        Send now-playing updates and scrobbles for all music-video library playback
      </label>}
      <p className="empty-state" style={{ padding: '8px 0' }}>
        Scrobbles require a video longer than 30 seconds and observed playback of half its duration or
        four minutes. Pauses and seeks do not earn listening time. Videos without usable artist/title
        metadata or a confirmed catalog match are skipped. Disabling or unlinking discards queued plays.
        Recommendation and genre lookups use the separate provider checkbox above.
      </p>
      {account && <p role="status">{account.queued} queued · {account.sent} sent · {account.ignored} ignored · {account.failed} failed (last 30 days)
        {account.lastScrobbledAt && <> · Last sent {new Date(account.lastScrobbledAt).toLocaleString()}</>}
      </p>}
      {(error || account?.lastError) && <p role="alert">{error instanceof Error ? error.message : account?.lastError}</p>}
    </div>
  );
}
