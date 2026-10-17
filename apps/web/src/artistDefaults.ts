export function defaultArtistRoot<T extends { id: number; targetConnectorId?: number | null }>(roots: T[] = []): T | undefined {
  return [...roots].sort((a, b) => Number(b.targetConnectorId != null) - Number(a.targetConnectorId != null) || a.id - b.id)[0];
}

export function defaultArtistProfile<T extends { id: number; name: string }>(profiles: T[] = []): T | undefined {
  return profiles.find(profile => profile.name.trim().toLowerCase() === 'any')
    ?? [...profiles].sort((a, b) => a.id - b.id)[0];
}
