// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import ApiKeyGate from '../src/components/ApiKeyGate';
import { api, getStoredApiKey, setStoredApiKey } from '../src/api/client';
it.each([503, 401, 'offline'])('handles saved credentials when server returns %s', async (status) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    localStorage.clear();
    setStoredApiKey('valid-credential');
    vi.spyOn(api.googleAuth, 'status').mockResolvedValue({ configured: false });
    vi.spyOn(api.localAuth, 'status').mockResolvedValue({ configured: true, setupAllowed: false });
    vi.stubGlobal('fetch', status === 'offline' ? vi.fn().mockRejectedValue(new Error('offline')) : vi.fn().mockResolvedValue(new Response('{}', { status: status as number })));
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () => { root.render(<ApiKeyGate><p>Protected</p></ApiKeyGate>); await new Promise(r => setTimeout(r, 30)); });
        await vi.waitFor(async () => {
            await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
            expect(host.textContent).not.toContain('Checking');
        });
        expect(getStoredApiKey()).toBe(status === 401 ? null : 'valid-credential');
        if (status !== 401) expect(host.querySelector('button')?.textContent).toContain('Retry');
        expect(host.textContent).toContain(status === 401 ? 'Incorrect API key' : status === 'offline' ? 'Could not reach the server' : 'Server unavailable');
    }
    finally {
        await act(async () => root.unmount());
        host.remove();
        localStorage.clear();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    }
});
