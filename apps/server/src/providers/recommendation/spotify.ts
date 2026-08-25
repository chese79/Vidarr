import type { RecommendationProvider, SimilarArtistHit } from './types.js';

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_BASE = 'https://api.spotify.com/v1';
const EXPIRY_BUFFER_MS = 60_000;

export interface SpotifyTokenState {
  accessToken: string | null;
  expiresAt: Date | null;
}

export interface SpotifyProviderConfig {
  clientId: string;
  clientSecret: string;
  tokenState: SpotifyTokenState;
}

export function createSpotifyProvider(
  config: SpotifyProviderConfig,
  onTokenRefreshed: (accessToken: string, expiresAt: Date) => void | Promise<void>,
): RecommendationProvider {
  async function ensureToken(): Promise<string> {
    const { accessToken, expiresAt } = config.tokenState;
    if (accessToken && expiresAt && expiresAt.getTime() - EXPIRY_BUFFER_MS > Date.now()) {
      return accessToken;
    }
    const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new Error(`Spotify token request failed: ${res.status}`);
    const body = await res.json();
    const newExpiresAt = new Date(Date.now() + Number(body.expires_in) * 1000);
    config.tokenState = { accessToken: body.access_token, expiresAt: newExpiresAt };
    await onTokenRefreshed(body.access_token, newExpiresAt);
    return body.access_token as string;
  }

  async function spotifyGet(path: string): Promise<any> {
    const token = await ensureToken();
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Spotify request failed: ${res.status}`);
    return res.json();
  }

  return {
    async getSimilarArtists(seedArtistNames: string[]): Promise<SimilarArtistHit[]> {
      const hits: SimilarArtistHit[] = [];
      for (const seed of seedArtistNames) {
        const searchBody = await spotifyGet(
          `/search?q=${encodeURIComponent(seed)}&type=artist&limit=1`,
        );
        const artistId = searchBody?.artists?.items?.[0]?.id;
        if (!artistId) continue;

        const relatedBody = await spotifyGet(`/artists/${artistId}/related-artists`);
        const related: any[] = relatedBody?.artists ?? [];
        for (const a of related) {
          hits.push({
            name: a.name as string,
            score: Number(a.popularity ?? 0) / 100,
            sourceRef: a.id as string,
            seedArtistName: seed,
            reason: `Related to ${seed} (Spotify)`,
          });
        }
      }
      return hits;
    },

    // Spotify's artist object carries a real controlled-vocabulary `genres`
    // array (e.g. "album rock", "alternative rock") — already present on the
    // same search response used above, no extra call needed.
    async getArtistGenres(artistName: string): Promise<string[]> {
      const searchBody = await spotifyGet(
        `/search?q=${encodeURIComponent(artistName)}&type=artist&limit=1`,
      );
      const artist = searchBody?.artists?.items?.[0];
      if (!artist || artist.name?.toLowerCase() !== artistName.toLowerCase()) return [];
      return (artist.genres ?? []) as string[];
    },
  };
}
