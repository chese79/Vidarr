export type CatalogMode = 'musicVideos' | 'live' | 'both';
export const CATALOG_MODE_KEY = 'vidarr.catalogMode';
export const CATALOG_LABELS: Record<CatalogMode, string> = {
  musicVideos: 'Music Videos', live: 'Live & Concerts', both: 'Both',
};
export function parseCatalogMode(value: string | null): CatalogMode {
  return value === 'live' || value === 'both' ? value : 'musicVideos';
}
export function isUnfilteredScreen(pathname: string): boolean {
  return pathname === '/history' || pathname === '/queue' || pathname.startsWith('/queue/');
}
export function matchesCatalog(mode: CatalogMode, item: { musicVideoId?: number | null; recordingPartId?: number | null; musicVideo?: { catalogKind?: string } | null }): boolean {
  if (!item.musicVideoId && !item.recordingPartId) return mode === 'both';
  const live = Boolean(item.recordingPartId) || item.musicVideo?.catalogKind === 'liveClassified';
  return mode === 'both' || (mode === 'live' ? live : !live);
}
