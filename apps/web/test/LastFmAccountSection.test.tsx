import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { LastFmStatus } from '@vidarr/shared-types';
import { LastFmAccountSection } from '../src/components/LastFmAccountSection';

const status: LastFmStatus = { linked: false, username: null, scrobblingEnabled: false, pendingAuthorization: false,
  pendingExpiresAt: null, lastPollAt: null, lastScrobbledAt: null, lastError: null, queued: 0, sent: 0, ignored: 0, failed: 0 };
function render(data: Partial<LastFmStatus> = {}) {
  const client = new QueryClient(); client.setQueryData(['lastfm'], { ...status, ...data });
  return renderToStaticMarkup(<QueryClientProvider client={client}><LastFmAccountSection /></QueryClientProvider>);
}
describe('Last.fm settings', () => {
  it('makes the all-user scope clear before linking, with no enable switch for unlinked accounts', () => {
    const html = render(); expect(html).toContain('all users'); expect(html).toContain('selected'); expect(html).toContain('Link account');
    expect(html).not.toContain('type="checkbox"');
  });
  it('offers completion after authorization and separates scrobbling from provider enablement', () => {
    const html = render({ linked: true, username: 'listener', pendingAuthorization: true });
    expect(html).toContain('Complete link after authorizing'); expect(html).toContain('listener');
    expect(html).toContain('type="checkbox"'); expect(html).toContain('separate provider checkbox');
  });
  it('reports rejected plays, pending delivery and account errors', () => {
    const html = render({ queued: 3, sent: 4, ignored: 1, failed: 2, lastError: 'Link your account again.' });
    expect(html).toContain('3 queued'); expect(html).toContain('4 sent'); expect(html).toContain('1 ignored');
    expect(html).toContain('2 failed'); expect(html).toContain('role="alert"'); expect(html).toContain('Link your account again.');
  });
});
