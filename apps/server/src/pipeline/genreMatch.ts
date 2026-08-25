import { getEnabledProviders } from './recommendations.js';

export interface StandardGenreMatch {
  genre: string;
  source: string;
}

// "Standard" genre matching = a controlled-vocabulary external source, not
// free text — currently only Spotify's artist.genres qualifies (see
// providers/recommendation/types.ts). Returns the first genre from the first
// enabled provider that has one for this artist; null if no enabled provider
// supports genre lookup or none has data for this artist.
export async function matchStandardGenre(artistName: string): Promise<StandardGenreMatch | null> {
  const providers = await getEnabledProviders();
  for (const { name, provider } of providers) {
    if (!provider.getArtistGenres) continue;
    try {
      const genres = await provider.getArtistGenres(artistName);
      if (genres.length) return { genre: genres[0], source: name };
    } catch {
      continue;
    }
  }
  return null;
}
