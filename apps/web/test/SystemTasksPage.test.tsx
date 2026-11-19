// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { api } from '../src/api/client';
import SystemTasksPage from '../src/pages/SystemTasksPage';
import type { ScheduledTask } from '@vidarr/shared-types';

let client: QueryClient, host: HTMLDivElement, root: ReturnType<typeof createRoot>, tasks: ScheduledTask[];
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  tasks = [{ id: 1, name: 'Library Sync', intervalMs: 86_400_000, scheduleType: 'daily', timeOfDay: '03:00', timeZone: 'America/Chicago',
    windowStart: '02:00', windowEnd: '10:00', enabled: true, continuePending: true, nextRunAt: '2026-11-20T09:00:00Z', lastRunAt: null, lastResult: null, lastError: null },
  { id: 2, name: 'Playback Monitor', intervalMs: 15_000, scheduleType: 'interval', timeOfDay: null, timeZone: 'America/Chicago',
    windowStart: null, windowEnd: null, enabled: true, continuePending: true, nextRunAt: null, lastRunAt: null, lastResult: null, lastError: null }];
  client.setQueryData(['systemTasks'], tasks);
  vi.spyOn(api.system, 'tasks').mockImplementation(async () => tasks);
  vi.spyOn(api.system, 'updateTask').mockImplementation(async (name, schedule) => {
    tasks = tasks.map(task => task.name === name ? { ...task, ...schedule } : task); return tasks.find(task => task.name === name)!;
  });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.restoreAllMocks(); });
async function mount() { await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter><SystemTasksPage /></MemoryRouter></QueryClientProvider>)); }
async function edit(name: string) { await act(async () => (host.querySelector(`[aria-label="Edit schedule for ${name}"]`) as HTMLButtonElement).click()); }
async function change(label: string, value: string) { await act(async () => { const input = host.querySelector(`[aria-label="${label}"]`) as HTMLInputElement; input.value = value; Simulate.change(input); }); }
async function submit(name: string) { await act(async () => { host.querySelector(`form[aria-label="Schedule ${name}"]`)!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); }

it('shows editable schedules for every task, including daily defaults and all-day playback', async () => {
  await mount(); expect(host.textContent).toContain('Daily at 03:00'); expect(host.textContent).toContain('02:00–10:00'); expect(host.textContent).toContain('All day');
  expect(host.querySelectorAll('button[aria-label^="Edit schedule for"]')).toHaveLength(2); expect(host.textContent).toContain('Next scheduled run');
  await edit('Library Sync'); await change('Daily time for Library Sync', '04:30'); await submit('Library Sync');
  await vi.waitFor(() => expect(api.system.updateTask).toHaveBeenCalledWith('Library Sync', expect.objectContaining({ scheduleType: 'daily', timeOfDay: '04:30', windowStart: '02:00', windowEnd: '10:00', timeZone: 'America/Chicago' })));
  expect(host.textContent).toContain('Daily at 04:30');
});

it('changes interval frequency and permits disabling its automatic schedule', async () => {
  await mount(); await edit('Playback Monitor'); await change('Frequency for Playback Monitor', '30');
  const enabled = host.querySelector('form input[type="checkbox"]') as HTMLInputElement;
  await act(async () => enabled.click()); await submit('Playback Monitor');
  await vi.waitFor(() => expect(api.system.updateTask).toHaveBeenCalledWith('Playback Monitor', expect.objectContaining({ scheduleType: 'interval', intervalMs: 30_000, enabled: false, windowStart: null, windowEnd: null })));
  expect(host.textContent).toContain('Disabled');
});

it('keeps failed edits and displays validation details instead of silently resetting drafts', async () => {
  vi.mocked(api.system.updateTask).mockRejectedValue(Error('The daily run time must be inside its automatic-run window'));
  await mount(); await edit('Library Sync'); await change('Daily time for Library Sync', '11:00'); await submit('Library Sync');
  await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain('inside its automatic-run window'));
  await act(async () => { client.setQueryData(['systemTasks'], [...tasks]); });
  expect((host.querySelector('[aria-label="Daily time for Library Sync"]') as HTMLInputElement).value).toBe('11:00');
});
