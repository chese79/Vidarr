import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AddArtistForm from '../src/components/AddArtistForm';
import { defaultArtistProfile, defaultArtistRoot } from '../src/artistDefaults';

it('defaults to Any and the oldest mapped music-video root regardless of response order', () => {
  const profiles = [{ id: 1, name: 'HD' }, { id: 9, name: 'Any' }];
  const roots = [{ id: 1, path: '/unmapped' }, { id: 5, path: '/new', targetConnectorId: 1 }, { id: 3, path: '/music-videos', targetConnectorId: 1 }];
  expect(defaultArtistProfile(profiles)?.id).toBe(9);
  expect(defaultArtistRoot(roots)?.id).toBe(3);
  const client = new QueryClient();
  client.setQueryData(['rootFolders'], roots); client.setQueryData(['qualityProfiles'], profiles);
  const html = renderToStaticMarkup(<QueryClientProvider client={client}><AddArtistForm onDone={() => {}} /></QueryClientProvider>);
  expect(html).toContain('<option value="3" selected="">/music-videos</option>');
  expect(html).toContain('<option value="9" selected="">Any</option>');
  expect(html).toMatch(/<button disabled="">Add Artist/);
});

it('handles missing configuration and uses stable fallbacks when no Any or mapped root exists', () => {
  expect(defaultArtistRoot()).toBeUndefined(); expect(defaultArtistProfile()).toBeUndefined();
  expect(defaultArtistRoot([{ id: 8 }, { id: 2 }])?.id).toBe(2);
  expect(defaultArtistProfile([{ id: 8, name: 'SD' }, { id: 2, name: 'HD' }])?.id).toBe(2);
});
