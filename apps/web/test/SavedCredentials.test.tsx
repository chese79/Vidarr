import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SettingsPage, { ProviderRow } from '../src/pages/SettingsPage';
import { MemoryRouter } from 'react-router-dom';

function render(saved: boolean) {
  return renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><ProviderRow config={{
    id: 1, provider: 'lastfm', enabled: true, apiKey: null, clientId: null, clientSecret: null,
    hasApiKey: saved, hasClientSecret: saved,
  }} /></QueryClientProvider>);
}
describe('saved credentials', () => {
  it('places the single global setlist key in Library beside IMVDb with an empty masked input', () => {
    const client = new QueryClient();
    client.setQueryData(['settings'], { hasImvdbApiKey: true, hasSetlistApiKey: true, namingFormat: '', transferMode: 'move' });
    const html = renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter><SettingsPage /></MemoryRouter></QueryClientProvider>);
    expect(html.indexOf('id="setlist-api-key"')).toBeGreaterThan(html.indexOf('id="imvdb-api-key"'));
    expect(html.indexOf('id="setlist-api-key"')).toBeLessThan(html.indexOf('id="naming-format"'));
    const input = html.match(/<input[^>]*id="setlist-api-key"[^>]*>/)?.[0];
    expect(input).toContain('type="password"'); expect(input).toContain('value=""');
    expect(input).toContain('•••••••• (saved; enter a replacement)');
    expect(html).toContain('Global event-history key for every artist');
  });
  it('shows saved masks without putting fake credentials in submitted input values', () => {
    const inputs = render(true).match(/<input[^>]*type="password"[^>]*>/g) ?? [];
    expect(inputs).toHaveLength(2);
    for (const input of inputs) { expect(input).toContain('•••••••• (saved; enter a replacement)'); expect(input).toContain('value=""'); }
  });
  it('keeps unsaved credential fields empty and clearly labeled', () => {
    const html = render(false);
    expect(html).not.toContain('••••••••'); expect(html).toContain('placeholder="API key"');
    expect(html).toContain('placeholder="Shared secret"');
  });
});
