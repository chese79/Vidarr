import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import QueuePage from '../src/pages/QueuePage';
import { QueueResultsPage } from '../src/components/QueueResults';

function result(id: number, eventType: string) {
  return { id, musicVideoId: id, eventType, date: '2026-10-10T10:00:00Z',
    data: JSON.stringify({ quality: '1080p', error: 'Private video' }),
    musicVideo: { title: `Result ${id}`, artist: { name: 'Artist' } } };
}

it('exposes ordering controls only for waiting downloads and disables boundary moves', () => {
  const client = new QueryClient();
  client.setQueryData(['queue'], ['downloading', 'queued', 'queued', 'importing'].map((status, index) => ({
    id: index + 1, status, progress: 0, musicVideo: { title: `Video ${index}`, artist: { id: 1, name: 'Artist' } },
  })));
  const html = renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter><QueuePage /></MemoryRouter></QueryClientProvider>);
  expect(html.match(/>Move to top<\/button>/g)).toHaveLength(2);
  expect(html).toContain('<button disabled="">Move to top</button>');
  expect(html).toContain('<button>Move to top</button>');
  expect(html).toContain('<button disabled="">Move to bottom</button>');
});

it('separates failed entries from active work and places completed results before failures', () => {
  const client = new QueryClient();
  client.setQueryData(['queue'], [
    { id: 1, status: 'downloading', progress: .5, musicVideo: { title: 'Active video', artist: { name: 'Artist' } } },
    { id: 2, status: 'failed', progress: 0, musicVideo: { title: 'Failed queue row', artist: { name: 'Artist' } } },
  ]);
  client.setQueryData(['queueResults', 'completed', 1, 3], { total: 4, items: [1, 2, 3].map(id => result(id, 'downloadFolderImported')) });
  client.setQueryData(['queueResults', 'failures', 1, 3], { total: 4, items: [4, 5, 6].map(id => result(id, 'downloadFailed')) });
  const html = renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter><QueuePage /></MemoryRouter></QueryClientProvider>);
  expect(html).toContain('Active video'); expect(html).not.toContain('Failed queue row');
  expect(html.indexOf('Recently completed')).toBeLessThan(html.indexOf('Recent failures'));
  expect(html).toContain('href="/queue/completed"'); expect(html).toContain('href="/queue/failures"');
  expect(html).toContain('1080p'); expect(html).toContain('Private video');
});

it('provides pagination beyond the first 50 retained results', () => {
  const client = new QueryClient();
  client.setQueryData(['queueResults', 'failures', 1, 50], { total: 51, items: [result(1, 'downloadFailed')] });
  const html = renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter><QueueResultsPage section="failures" /></MemoryRouter></QueryClientProvider>);
  expect(html).toContain('51 results'); expect(html).toContain('Next');
  expect(html).toContain('Private video');
});

it('provides guarded reconciliation for uncertain submissions and separates import from server readiness', () => {
  const client = new QueryClient();
  client.setQueryData(['queue'], [{ id: 9, status: 'submissionUnknown', progress: 0,
    musicVideo: { title: 'Uncertain', artist: { id: 1, name: 'Artist' } } }]);
  client.setQueryData(['queueResults', 'completed', 1, 3], { total: 2, items: [
    { ...result(1, 'downloadFolderImported'), deliveryStatus: 'awaitingServerCataloging' },
    { ...result(2, 'downloadFolderImported'), deliveryStatus: 'readyToPlay' },
  ] });
  const html = renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter><QueuePage /></MemoryRouter></QueryClientProvider>);
  expect(html).toContain('Resolve submission'); expect(html).toContain('client&#x27;s queue and history');
  expect(html).toMatch(/<button disabled="">Link existing job/);
  expect(html).toContain('awaiting server cataloging'); expect(html).toContain('Ready to play on target server');
});
