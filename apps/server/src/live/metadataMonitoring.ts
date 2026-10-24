// Compatibility entry point for existing scheduled-task identities.
// setlist.fm history is only loaded by an explicit user action, never a cursor/job.
export async function runLiveMetadataMonitoring() {
  return 'setlist.fm is on request only; no event history searched or traversed';
}
