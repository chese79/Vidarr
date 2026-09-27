import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import DiscoverPage from '../src/pages/DiscoverPage';

function renderDiscover(recommendations: unknown[]) {
  const client = new QueryClient();
  client.setQueryData(['recommendations'], recommendations);
  client.setQueryData(['rootFolders'], [{ id: 1 }]);
  client.setQueryData(['qualityProfiles'], [{ id: 1 }]);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter><DiscoverPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Discover page layout', () => {
  it('omits the alphabet rail when there are no recommendations', () => {
    const html = renderDiscover([]);
    expect(html).not.toContain('class="letter-rail"');
    expect(html).toContain('No recommendations match these filters');
    expect(html).not.toContain('Add a root folder and a quality profile');
  });

  it('places the alphabet rail beside the filters and results', () => {
    const html = renderDiscover([{
      id: 1, artistName: 'Example Artist', mbid: null, aggregateScore: 2,
      genre: null, playCount: 0, dateFound: '2026-09-26', sourceHits: [],
    }]);
    expect(html).toMatch(/class="library-layout"><nav class="letter-rail"[\s\S]*<\/nav><div class="library-main">/);
    expect(html).toContain('Example Artist');
  });
});
