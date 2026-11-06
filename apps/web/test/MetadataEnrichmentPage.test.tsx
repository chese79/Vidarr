// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import MetadataEnrichmentPage from '../src/pages/MetadataEnrichmentPage';
describe('MTV metadata review page', () => {
  it('shows scan automation, retained failures, sources and current versus proposed fields', () => {
    const client = new QueryClient();
    client.setQueryData(['libraryconnectors'], [{ id: 4, name: 'JF', type: 'jellyfin', enabled: true, videoLibraryId: 'videos' }]);
    client.setQueryData(['metadata-enrichment'], [{ id: 1, connectorId: 4, status: 'paused', processed: 10, updated: 2, completeCount: 1, reviewCount: 6, unknownCount: 0, failedCount: 1, createdAt: '2026-11-04T00:00:00Z', error: 'Provider unavailable' }]);
    client.setQueryData(['metadata-enrichment-items', 1, 1, '', ''], { total: 26, items: [{ id: 8, title: 'Tomorrow', artistName: 'Morrissey', status: 'review', changed: false, error: null, before: { Facts: { album: null } }, proposal: { missing: ['album'], notes: ['Review the release edition.'], evidence: [{ source: 'MusicBrainz', entityId: 'release', url: 'https://musicbrainz.org/release/release', observedAt: '2026-11-04T00:00:00Z', facts: { album: 'Your Arsenal' }, reason: 'Version needs review.', verified: false, requiresArtistReview: true }] } }] });
    const html = renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter><MetadataEnrichmentPage /></MemoryRouter></QueryClientProvider>);
    expect(html).toContain('scans queue enrichment automatically');
    expect(html).toContain('Provider unavailable'); expect(html).toContain('Retry failed');
    expect(html).toContain('Current</th><th>Proposed'); expect(html).toContain('Your Arsenal');
    expect(html).toContain('https://musicbrainz.org/release/release');
    expect(html).toContain('populated fields to be corrected'); expect(html).toContain('Apply selected facts');
    expect(html).toContain('Artist identity review is required');
    expect(html).toContain('26 items'); expect(html).toContain('Artist Review');
  });
});
