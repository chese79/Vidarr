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
  // data (Spotify's artist.genres); MusicBrainz has none, and Last.fm's
  // "tags" are user-submitted free text, not a controlled vocabulary.
  getArtistGenres?(artistName: string): Promise<string[]>;
}
