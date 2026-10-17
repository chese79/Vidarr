import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DEFAULT_VALIDATION_SETTINGS } from '@vidarr/shared-types';
import ValidationQualityPage from '../src/pages/ValidationQualityPage';

it('combines explained validation policies with existing quality controls at the bottom', () => {
  const client = new QueryClient();
  client.setQueryData(['validationSettings'], DEFAULT_VALIDATION_SETTINGS);
  const html = renderToStaticMarkup(<QueryClientProvider client={client}><ValidationQualityPage /></QueryClientProvider>);
  expect(html).toContain('Validation/Quality');
  expect(html).toContain('Queued videos retain the category assigned from their selected source');
  expect(html.indexOf('Quality Profiles')).toBeGreaterThan(html.indexOf('Save validation settings'));
  expect(html).toContain('If unchecked: no video-stream');
  expect(html.match(/<input[^>]*aria-label="Check video file for Initial user imports"[^>]*>/)?.[0]).toContain('checked=""');
  expect(html.match(/<input[^>]*aria-label="Check video file for Canonical source downloads"[^>]*>/)?.[0]).not.toContain('checked=""');
  expect(html.match(/Import \/ register <small>Required/g)).toHaveLength(3);
  expect(html.match(/Confirm delivery <small>Required/g)).toHaveLength(3);
});
