import { useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

export function YoutubeCookiesSection() {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const status = useQuery({ queryKey: ['youtubeCookies'], queryFn: api.settings.youtubeCookies });
  const save = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > 256 * 1024) throw new Error('Cookie file must be at most 256 KB');
      return api.settings.saveYoutubeCookies(await file.text());
    },
    onSuccess: result => queryClient.setQueryData(['youtubeCookies'], result),
    onSettled: () => { if (input.current) input.current.value = ''; },
  });
  const remove = useMutation({
    mutationFn: api.settings.removeYoutubeCookies,
    onSuccess: result => { queryClient.setQueryData(['youtubeCookies'], result); save.reset(); },
  });
  const busy = save.isPending || remove.isPending;
  return <div className="card">
    <h3 style={{ marginTop: 0 }}>YouTube account cookies</h3>
    <p>Upload a Netscape-format cookie file from a YouTube account that can watch the videos you want.
      Cookies authenticate searches and downloads; they do not grant access to other private videos.</p>
    <div className="form-row">
      <input type="password" readOnly autoComplete="off" aria-label="Saved YouTube cookies"
        value={status.data?.configured ? 'configured' : ''} placeholder="No cookies saved" />
      <span role="status">{status.isLoading ? 'Checking…' : status.data?.configured ? 'Cookies configured' : 'No cookies configured'}</span>
    </div>
    <div className="form-row">
      <label htmlFor="youtube-cookie-file">{status.data?.configured ? 'Replace cookie file' : 'Upload cookie file'}</label>
      <input id="youtube-cookie-file" ref={input} type="file" accept=".txt" disabled={busy || status.isLoading || status.isError}
        onChange={event => { const file = event.target.files?.[0]; if (file) { remove.reset(); save.mutate(file); } }} />
      <button type="button" className="secondary" disabled={!status.data?.configured || busy}
        onClick={() => remove.mutate()}>Remove cookies</button>
    </div>
    {save.isPending && <p role="status">Saving cookies…</p>}
    {(status.error || save.error || remove.error) && <p role="alert">{(status.error || save.error || remove.error)?.message}</p>}
    <p className="empty-state" style={{ padding: '4px 0 0' }}>Cookies are saved on the Vidarr server. Replace them if YouTube expires the session.
      Removing cookies affects new requests; active downloads keep their current session.</p>
  </div>;
}
