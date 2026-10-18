import { afterEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PasswordResetForm from '../../web/src/components/PasswordResetForm';
import { api } from '../../web/src/api/client';

afterEach(() => vi.unstubAllGlobals());
it('explains ownership proof, confirmation, non-destructive console recovery and a route back to sign-in', () => {
  const html = renderToStaticMarkup(createElement(PasswordResetForm, { initialUsername: 'owner', onComplete: () => {}, onCancel: () => {} }));
  expect(html).toContain('Recovery API key'); expect(html).toContain('Confirm new password');
  expect(html).toContain('recoverOwnerLogin.js --yes'); expect(html).toContain('Back to sign in');
  expect(html).toContain('value="owner"'); expect(html).not.toContain('factoryReset');
  expect(html.match(/type="password"/g)).toHaveLength(3);
});
it('submits recovery proof only in the protected API header and does not require or write browser storage', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ adminUsername: 'owner' }), { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  expect(await api.localAuth.resetPassword(' recovery-proof ', ' owner ', 'new-password')).toEqual({ adminUsername: 'owner' });
  expect(fetch.mock.calls[0]).toEqual(['/api/v1/auth/login/credentials', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'recovery-proof' }, body: JSON.stringify({ username: 'owner', password: 'new-password' }) }]);
});
it('keeps incorrect recovery proof actionable without falsely reporting a reset', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })));
  await expect(api.localAuth.resetPassword('wrong', 'owner', 'new-password')).rejects.toThrow('recovery API key is incorrect');
});
