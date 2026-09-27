// Upload channel names are observations, not artist identities. A VEVO suffix
// is a useful artist hint, but the result still requires MusicBrainz review.
export function artistNameHint(observedName: string): string {
  const trimmed = observedName.trim();
  const vevo = /^(.*?)\s*VEVO$/i.exec(trimmed);
  return vevo?.[1]?.trim() || trimmed;
}

export function isUsableArtistHint(name: string): boolean {
  return Boolean(name) && !/^(unknown artist|various artists?|vevo)$/i.test(name);
}
