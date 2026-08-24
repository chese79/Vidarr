export interface IndexerSearchResult {
  indexerId: number;
  indexerName: string;
  title: string;
  quality: string;
  sizeBytes: number | null;
  seeders: number | null;
  downloadUrl: string; // magnet URI or .torrent/.nzb URL
  publishDate: string | null;
}
