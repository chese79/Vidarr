import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import DownloadProgress from '../src/components/DownloadProgress';

it('shows a loading indicator instead of disappearing before the first queue response', () => {
  const client = new QueryClient();
  const html = renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter><DownloadProgress /></MemoryRouter></QueryClientProvider>);
  expect(html).toContain('Loading download updates');
});

it('shows unavailable updates when the first queue request fails', async () => {
  const client = new QueryClient();
  await client.prefetchQuery({ queryKey: ['queue'], queryFn: async () => { throw new Error('offline'); }, retry: false });
  const html = renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter><DownloadProgress /></MemoryRouter></QueryClientProvider>);
  expect(html).toContain('Download updates unavailable');
});

it('shows active progress and waiting count while excluding failed downloads', () => {
  const client = new QueryClient();
  client.setQueryData(['queue'], [
    { id: 1, status: 'downloading', progress: .45, musicVideo: { title: 'Song', artist: { name: 'Artist' } } },
    { id: 2, status: 'queued', progress: 0 }, { id: 3, status: 'failed', progress: .2 },
  ]);
  const html = renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter><DownloadProgress /></MemoryRouter></QueryClientProvider>);
  expect(html).toContain('1 active'); expect(html).toContain('45%'); expect(html).toContain('1 video waiting');
  expect(html).toContain('value="0.45"'); expect(html).toContain('aria-label="Artist — Song"');
  expect(html).not.toContain('20%');
});

it('keeps unresolved submissions visible even when no transfer is active', () => {
  const client = new QueryClient();
  client.setQueryData(['queue'], [{ id: 1, status: 'submissionUnknown', progress: 0 }]);
  const html = renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter><DownloadProgress /></MemoryRouter></QueryClientProvider>);
  expect(html).toContain('1 submission need reconciliation');
  expect(html).toContain('href="/queue"');
});
