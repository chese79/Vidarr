// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ActionButton, ActionForm, ButtonFeedback } from '../src/components/ButtonFeedback';
import { trackButtonRequest } from '../src/buttonFeedback';
import type { ReactNode } from 'react';

let host: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear(); host.remove(); vi.clearAllTimers(); vi.useRealTimers();
});
async function render(children: ReactNode) {
  await act(async () => root.render(<ButtonFeedback client={client}><QueryClientProvider client={client}>{children}</QueryClientProvider></ButtonFeedback>));
}
const button = (index = 0) => host.querySelectorAll('button')[index];
async function click(index = 0) { await act(async () => button(index).click()); }
async function tick(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

it('acknowledges synchronous buttons temporarily, including keyboard-style native activation', async () => {
  const handler = vi.fn();
  await render(<ActionButton onClick={handler}>Open filters</ActionButton>);
  await click();
  expect(handler).toHaveBeenCalledTimes(1);
  expect(button().textContent).toBe('Clicked');
  expect(button().dataset.buttonFeedback).toBe('engaged');
  expect(button().disabled).toBe(false);
  await tick(701);
  expect(button().textContent).toBe('Open filters');
  expect(button().dataset.buttonFeedback).toBeUndefined();
});

it('tracks asynchronous handlers, blocks repeat submission, and leaves other buttons usable', async () => {
  const work = deferred(), handler = vi.fn(() => work.promise), other = vi.fn();
  await render(<><ActionButton onClick={handler}>Search</ActionButton><ActionButton onClick={other}>Other</ActionButton></>);
  await click(); await tick(1);
  expect(button().textContent).toBe('Working…');
  expect(button().getAttribute('aria-busy')).toBe('true');
  expect(button().disabled).toBe(true);
  await click(); expect(handler).toHaveBeenCalledTimes(1);
  await click(1); expect(other).toHaveBeenCalledTimes(1);
  await tick(2000); expect(button().textContent).toBe('Working…');
  await act(async () => work.resolve());
  expect(button().textContent).toBe('Search');
  expect(button().disabled).toBe(false);
  expect(host.querySelector('[role="status"]')?.textContent).not.toContain('complete');
});

it('shows failure briefly, preserves the original accessible label and permits retry', async () => {
  const work = deferred();
  await render(<ActionButton aria-label="Save configuration" onClick={() => work.promise}>Save</ActionButton>);
  await click(); await tick(1);
  await act(async () => work.reject(new Error('Server unavailable')));
  expect(button().textContent).toBe('Failed');
  expect(button().dataset.buttonFeedback).toBe('error');
  expect(button().getAttribute('aria-label')).toBe('Save configuration');
  expect(button().disabled).toBe(false);
  expect(host.querySelector('[role="status"]')?.textContent).toContain('failed');
  await tick(1601); expect(button().textContent).toBe('Save');
});

it('keeps native form submission working and observes the full async submit handler', async () => {
  const work = deferred(), submit = vi.fn((event: React.FormEvent) => { event.preventDefault(); return work.promise; });
  await render(<ActionForm onSubmit={submit}><input defaultValue="value" /><ActionButton type="submit">Save form</ActionButton></ActionForm>);
  await click();
  expect(submit).toHaveBeenCalledTimes(1);
  await tick(1); expect(button().textContent).toBe('Working…');
  await act(async () => work.resolve());
  expect(button().textContent).toBe('Save form'); expect(button().disabled).toBe(false);
});

it('respects HTML validation and acknowledges cancellation without claiming processing', async () => {
  const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
  await render(<ActionForm onSubmit={submit}><input required /><ActionButton type="submit">Submit</ActionButton></ActionForm>);
  await click(); await tick(1);
  expect(submit).not.toHaveBeenCalled();
  expect(button().getAttribute('aria-busy')).toBeNull();
  expect(button().textContent).toBe('Clicked');
});

it('tracks mutation lifetimes when mutate returns void and preserves a specific pending message', async () => {
  const work = deferred();
  function Save() {
    const save = useMutation({ mutationFn: () => work.promise });
    return <ActionButton disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving settings…' : 'Save settings'}</ActionButton>;
  }
  await render(<Save />); await click(); await tick(1);
  expect(button().textContent).toBe('Saving settings…');
  expect(button().dataset.buttonFeedback).toBe('pending');
  await tick(2500); expect(button().dataset.buttonFeedback).toBe('pending');
  await act(async () => work.resolve()); await tick(1);
  expect(button().textContent).toBe('Save settings');
});

it('tracks direct API promises even if a click handler does not return its promise', async () => {
  const work = deferred();
  await render(<ActionButton onClick={() => { void trackButtonRequest(work.promise).catch(() => {}); }}>Refresh</ActionButton>);
  await click(); await tick(1); expect(button().textContent).toBe('Working…');
  await act(async () => work.resolve()); expect(button().textContent).toBe('Refresh');
});

it('does not attach background requests to an unrelated button, and disabled buttons do nothing', async () => {
  const work = deferred(), handler = vi.fn();
  await render(<><ActionButton>Local action</ActionButton><ActionButton disabled onClick={handler}>Unavailable</ActionButton></>);
  await click();
  const background = trackButtonRequest(work.promise);
  await tick(701); expect(button().textContent).toBe('Local action');
  await click(1); expect(handler).not.toHaveBeenCalled();
  await act(async () => work.resolve()); await background;
});

it('restores updated toggle labels and safely finishes after a control unmounts', async () => {
  const work = deferred();
  function Toggle() {
    const [enabled, setEnabled] = useState(false);
    return <ActionButton onClick={() => setEnabled(!enabled)}>{enabled ? 'Pause' : 'Resume'}</ActionButton>;
  }
  await render(<Toggle />); await click(); await tick(701); expect(button().textContent).toBe('Pause');
  await render(<ActionButton onClick={() => work.promise}>Long operation</ActionButton>);
  await click(); await tick(1); await render(<p>Other page</p>);
  await act(async () => work.resolve()); expect(host.textContent).toContain('Other page');
});
