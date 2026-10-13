let tail: Promise<void> = Promise.resolve();

// Full-file validation is CPU intensive. Share one worker with discovery samples.
export async function withValidationWorker<T>(work: () => Promise<T>): Promise<T> {
  const previous = tail;
  let release!: () => void;
  tail = new Promise<void>(resolve => { release = resolve; });
  await previous;
  try { return await work(); } finally { release(); }
}
