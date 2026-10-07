export interface SimilarArtistHit {
  name: string;
  score: number;
  sourceRef?: string;
  seedArtistName: string;
  reason: string;
}

export interface RecommendationProvider {
  getSimilarArtists(seedArtistNames: string[]): Promise<SimilarArtistHit[]>;
  // Optional: a "standard" (controlled-vocabulary, not free-text) genre
  // source for an artist — used for genre matching/filtering, a separate
  // concern from similarity recommendations but reusing the same provider
  // config/auth. Only implemented by providers with real structured genre
  // data (Spotify's artist.genres). Last.fm's "tags" are user-submitted free
  // text, not a controlled vocabulary — see getArtistTags below. (MusicBrainz
  // has genres too, but they come from the metadata provider, not this one.)
  getArtistGenres?(artistName: string): Promise<string[]>;
  // Optional: crowd-sourced tags for an artist with a weight each (Last.fm).
  // Free text rather than a vocabulary — pipeline/artistGenres.ts filters them
  // against the MusicBrainz genre list before they count as genres.
  getArtistTags?(artist: { name: string; mbid?: string | null }): Promise<Array<{ name: string; count: number }>>;
}
