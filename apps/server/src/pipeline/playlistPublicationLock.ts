// One process owns Vidarr's scheduler/API. Serialize all publication lifecycle
// operations by playlist, including rebind/delete, across every connector.
const pending = new Map<number, Promise<void>>();
export async function withPlaylistPublication<T>(id: number, work: () => Promise<T>): Promise<T> {
  const previous = pending.get(id) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  pending.set(id, current);
  await previous;
  try { return await work(); }
  finally { release(); if (pending.get(id) === current) pending.delete(id); }
}
