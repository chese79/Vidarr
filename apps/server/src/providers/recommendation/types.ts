export interface SimilarArtistHit {
  name: string;
  score: number;
  sourceRef?: string;
  seedArtistName: string;
  reason: string;
}

export interface RecommendationProvider {
  getSimilarArtists(seedArtistNames: string[]): Promise<SimilarArtistHit[]>;
}
