import type { ConnectorSyncReport, PlaylistPublication } from '@vidarr/shared-types';

export function describePublication(publication: PlaylistPublication | undefined): string {
  if (!publication) return 'Publication was not confirmed. Use Push to retry this saved playlist.';
  if (publication.status === 'failed') return `Saved in Vidarr, but publication failed: ${publication.error ?? 'unknown error'}. Use Push to retry this saved playlist.`;
  if (publication.status === 'partial') return `Published ${publication.matchedCount} video(s); ${publication.unmatchedTitles.length} could not be found in the playback library. Review the saved playlist and use Push to retry.`;
  return `Published ${publication.matchedCount} video(s) to the playback library.`;
}

// One sentence about the library re-read that happens just before a playlist is
// built, or '' when no connector took part. A failure is spelled out because the
// playlist was then built from older data and the user may want to retry.
export function describeSync(reports: ConnectorSyncReport[] | undefined): string {
  if (!reports?.length) return '';
  return reports.map((r) => {
    if (r.status === 'synced') {
      const count = r.videoCount ?? 0;
      const base = `${count} video${count === 1 ? '' : 's'}`;
      // Only exact catalog matches can be put in a playlist, so say how many there are.
      const matched = r.matchedCount === undefined ? '' : `, ${r.matchedCount} matched to your catalog`;
      return `Synced ${r.name} (${base}${matched}).`;
    }
    if (r.status === 'skipped') return `${r.name}: ${r.message ?? 'sync skipped, using last results.'}`;
    return `Could not sync ${r.name} (${r.message ?? 'unknown error'}); used the last synced data.`;
  }).join(' ');
}

export function syncNeedsAttention(reports: ConnectorSyncReport[] | undefined): boolean {
  return Boolean(reports?.some((r) => r.status === 'failed'));
}
