import { ActionButton, ActionForm } from '../components/ButtonFeedback';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { ScheduledTask, UpdateTaskSchedule } from '@vidarr/shared-types';

const units = [{ value: 1000, label: 'seconds' }, { value: 60_000, label: 'minutes' },
  { value: 3_600_000, label: 'hours' }, { value: 86_400_000, label: 'days' }];
function formatInterval(ms: number): string {
  const unit = [...units].reverse().find(value => ms >= value.value && ms % value.value === 0) ?? units[0];
  return `${ms / unit.value} ${unit.label}`;
}
function ScheduleEditor({ task, onClose }: { task: ScheduledTask; onClose: () => void }) {
  const client = useQueryClient();
  const initialUnit = [...units].reverse().find(value => task.intervalMs % value.value === 0) ?? units[0];
  const [mode, setMode] = useState<'interval' | 'daily'>(task.scheduleType ?? 'interval');
  const [unit, setUnit] = useState(initialUnit.value);
  const [amount, setAmount] = useState(String(task.intervalMs / initialUnit.value));
  const [time, setTime] = useState(task.timeOfDay ?? '03:00');
  const [zone, setZone] = useState(task.timeZone ?? 'America/Chicago');
  const [enabled, setEnabled] = useState(task.enabled !== false);
  const [continuePending, setContinuePending] = useState(task.continuePending !== false);
  const [windowed, setWindowed] = useState(Boolean(task.windowStart && task.windowEnd));
  const [start, setStart] = useState(task.windowStart ?? '02:00');
  const [end, setEnd] = useState(task.windowEnd ?? '10:00');
  const save = useMutation({
    mutationFn: (schedule: UpdateTaskSchedule) => api.system.updateTask(task.name, schedule),
    onSuccess: updated => {
      client.setQueryData<ScheduledTask[]>(['systemTasks'], current => current?.map(value => value.id === task.id ? updated : value));
      void client.invalidateQueries({ queryKey: ['systemTasks'] }); onClose();
    },
  });
  return <ActionForm aria-label={`Schedule ${task.name}`} onSubmit={event => {
    event.preventDefault();
    const common = { enabled, continuePending, timeZone: zone.trim(), windowStart: windowed ? start : null, windowEnd: windowed ? end : null };
    save.mutate(mode === 'daily' ? { ...common, scheduleType: 'daily', timeOfDay: time }
      : { ...common, scheduleType: 'interval', intervalMs: Math.round(Number(amount) * unit) });
  }}>
    <div className="form-row">
      <label><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} /> Automatic runs enabled</label>
      {task.supportsContinuation && <label><input type="checkbox" checked={continuePending} onChange={event => setContinuePending(event.target.checked)} /> Keep working while pending work remains</label>}
      <label>Schedule <select aria-label={`Schedule type for ${task.name}`} value={mode} onChange={event => setMode(event.target.value as 'interval' | 'daily')}>
        <option value="interval">Every interval</option><option value="daily">Daily at a time</option>
      </select></label>
      {mode === 'daily' ? <label>Time <input aria-label={`Daily time for ${task.name}`} type="time" required value={time} onChange={event => setTime(event.target.value)} /></label>
        : <><label>Every <input aria-label={`Frequency for ${task.name}`} type="number" step="any" min={1000 / unit} max={2_147_483_647 / unit} required value={amount} onChange={event => setAmount(event.target.value)} /></label>
          <select aria-label={`Frequency unit for ${task.name}`} value={unit} onChange={event => setUnit(Number(event.target.value))}>{units.map(value => <option key={value.value} value={value.value}>{value.label}</option>)}</select></>}
      <label>Time zone <input aria-label={`Time zone for ${task.name}`} required value={zone} onChange={event => setZone(event.target.value)} placeholder="America/Chicago" /></label>
    </div>
    <div className="form-row">
      <label><input aria-label={`Limit automatic runs for ${task.name}`} type="checkbox" checked={windowed} onChange={event => setWindowed(event.target.checked)} /> Limit automatic runs to a time window</label>
      {windowed && <><label>From <input aria-label={`Window start for ${task.name}`} type="time" required value={start} onChange={event => setStart(event.target.value)} /></label>
        <label>Until <input aria-label={`Window end for ${task.name}`} type="time" required value={end} onChange={event => setEnd(event.target.value)} /></label></>}
      <ActionButton type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save schedule'}</ActionButton>
      <ActionButton type="button" className="secondary" onClick={onClose}>Cancel</ActionButton>
    </div>
    {save.isError && <p role="alert">{(save.error as Error).message}</p>}
    <p className="empty-state">Changes apply immediately to future starts. Active work finishes safely. Run Now works outside the automatic window.
      {task.supportsContinuation && ' Follow-up work stays inside the window; turn off Keep working to process one batch per scheduled run.'}</p>
  </ActionForm>;
}

export default function SystemTasksPage() {
  const client = useQueryClient();
  const [editing, setEditing] = useState<number | null>(null);
  const tasks = useQuery({ queryKey: ['systemTasks'], queryFn: api.system.tasks, refetchInterval: 5000 });
  const run = useMutation({ mutationFn: api.system.runTask, onSuccess: () => { void client.invalidateQueries({ queryKey: ['systemTasks'] }); } });
  const backfill = useMutation({ mutationFn: api.system.regenerateLibraryMetadata });
  return <div>
    <div className="page-header"><h2>System / Tasks</h2></div>
    <p>Library Sync defaults to 3:00 a.m. Heavy background tasks default to 2:00–10:00 a.m. in America/Chicago. Playback and download progress checks remain available all day.</p>
    <div className="card"><div className="form-row" style={{ alignItems: 'center', marginBottom: 0 }}>
      <ActionButton className="secondary" onClick={() => backfill.mutate()} disabled={backfill.isPending}>{backfill.isPending ? 'Running…' : 'Regenerate library metadata files'}</ActionButton>
      <span className="empty-state" style={{ padding: 0 }} aria-live="polite">{backfill.isError ? `Failed: ${(backfill.error as Error).message}` : backfill.data ? `Wrote ${backfill.data.written}, failed ${backfill.data.failed}` : 'Writes/updates the .nfo + thumbnail sidecar for every already-downloaded video (Plex/Jellyfin convention).'}</span>
    </div></div>
    {tasks.isPending ? <p role="status">Loading scheduled tasks…</p> : tasks.isError ? <p role="alert">Could not load scheduled tasks: {(tasks.error as Error).message}</p>
      : tasks.data?.length ? <table><thead><tr><th>Task</th><th>Schedule</th><th>Automatic window</th><th>Next scheduled run</th><th>Last run</th><th>Result</th><th>Actions</th></tr></thead><tbody>
        {tasks.data.map(task => <TaskRows key={task.id} task={task} editing={editing === task.id} onEdit={() => setEditing(task.id)} onClose={() => setEditing(null)}
          onRun={() => run.mutate(task.name)} busy={Boolean(task.running || run.isPending && run.variables === task.name)} />)}
      </tbody></table> : <p className="empty-state">No scheduled tasks yet — they register on first server start.</p>}
    {run.isError && <p role="alert">{(run.error as Error).message}</p>}
  </div>;
}
function TaskRows({ task, editing, onEdit, onClose, onRun, busy }: { task: ScheduledTask; editing: boolean; onEdit: () => void; onClose: () => void; onRun: () => void; busy: boolean }) {
  return <><tr>
    <td>{task.name}</td>
    <td>{task.enabled === false ? 'Disabled' : task.scheduleType === 'daily' ? `Daily at ${task.timeOfDay}` : `Every ${formatInterval(task.intervalMs)}`}<small style={{ display: 'block' }}>{task.timeZone ?? 'America/Chicago'}</small></td>
    <td>{task.windowStart && task.windowEnd ? `${task.windowStart}–${task.windowEnd}` : 'All day'}</td>
    <td>{task.nextRunAt && task.enabled !== false ? new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short', timeZone: task.timeZone ?? 'America/Chicago' }).format(new Date(task.nextRunAt)) : '—'}</td>
    <td>{task.lastRunAt ? new Date(task.lastRunAt).toLocaleString() : 'Never'}</td>
    <td>{task.running ? 'Running…' : task.lastResult ?? '—'}{task.lastResult === 'failed' && task.lastError && <div className="empty-state" style={{ padding: '2px 0', fontSize: 12 }}>{task.lastError}</div>}</td>
    <td><ActionButton className="secondary" aria-label={`Run ${task.name} now`} onClick={onRun} disabled={busy}>Run Now</ActionButton>{' '}
      <ActionButton className="secondary" aria-label={`Edit schedule for ${task.name}`} onClick={onEdit}>Edit schedule</ActionButton></td>
  </tr>{editing && <tr><td colSpan={7}><ScheduleEditor task={task} onClose={onClose} /></td></tr>}</>;
}
