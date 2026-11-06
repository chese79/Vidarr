// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { expect, it } from 'vitest';
import MetadataEnrichmentPage from '../../web/src/pages/MetadataEnrichmentPage';

it('resets field and correction consent when polling replaces evidence with a shorter proposal', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(['libraryconnectors'], []);
  client.setQueryData(['metadata-enrichment'], [{ id: 1, status: 'paused', createdAt: new Date().toISOString() }]);
  const row = (album: string) => ({ source: 'MusicBrainz', entityId: album, url: 'https://musicbrainz.org/', observedAt: new Date().toISOString(), facts: { album }, reason: 'fixture' });
  const item = { id: 9, artistName: 'Artist', title: 'Song', status: 'review', before: { Facts: {}, Fingerprint: 'one' }, proposal: { evidence: [row('A'), row('B')], missing: ['album'], notes: [] } };
  const key = ['metadata-enrichment-items', 1, 1, '', ''];
  client.setQueryData(key, { total: 1, items: [item] });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => { root.render(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, null, createElement(MetadataEnrichmentPage)))); });
    const select = host.querySelector('details select') as HTMLSelectElement;
    await act(async () => { select.value = '1'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    await act(async () => { for (const box of host.querySelectorAll<HTMLInputElement>('details input[type=checkbox]')) box.click(); });
    expect(host.querySelectorAll('details input:checked').length).toBe(2);
    await act(async () => { client.setQueryData(key, { total: 1, items: [{ ...item, proposal: { ...item.proposal, evidence: [row('C')] } }] }); await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(host.querySelector('details')?.textContent).toContain('C');
    expect(host.querySelectorAll('details input:checked').length).toBe(0);
    expect((host.querySelector('details select') as HTMLSelectElement).value).toBe('0');
  } finally { await act(async () => root.unmount()); client.clear(); host.remove(); }
});
