import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProviderRow } from '../src/pages/SettingsPage';

function render(saved: boolean) {
  return renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><ProviderRow config={{
    id: 1, provider: 'lastfm', enabled: true, apiKey: null, clientId: null, clientSecret: null,
    hasApiKey: saved, hasClientSecret: saved,
  }} /></QueryClientProvider>);
}
describe('saved credentials', () => {
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
