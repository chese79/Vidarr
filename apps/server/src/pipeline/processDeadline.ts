import type { ChildProcess } from 'node:child_process';

// Bound process lifetime, including a child that ignores graceful termination.
export function processDeadline(child: ChildProcess, milliseconds: number, label: string, reject: (error: Error) => void): () => void {
  let force: ReturnType<typeof setTimeout> | undefined;
  const timer = setTimeout(() => {
    force = setTimeout(() => child.kill('SIGKILL'), 5_000);
    force.unref();
    child.kill('SIGTERM');
    reject(new Error(`${label} timed out after ${Math.round(milliseconds / 1000)} seconds; retained for retry.`));
  }, milliseconds);
  timer.unref();
  const cleanup = () => { clearTimeout(timer); if (force) clearTimeout(force); };
  child.once('close', cleanup);
  child.once('error', cleanup);
  return cleanup;
}

export function positiveTimeout(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
