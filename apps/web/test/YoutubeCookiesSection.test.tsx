import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { YoutubeCookiesSection } from '../src/components/YoutubeCookiesSection';

it('shows a masked saved indicator and upload/remove controls without cookie contents', () => {
  const client = new QueryClient();
  client.setQueryData(['youtubeCookies'], { configured: true });
  const html = renderToStaticMarkup(<QueryClientProvider client={client}><YoutubeCookiesSection /></QueryClientProvider>);
  expect(html).toContain('type="password"');
  expect(html).toContain('Cookies configured');
  expect(html).toContain('Replace cookie file');
  expect(html).toContain('Remove cookies');
});
