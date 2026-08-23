# vidarr

A self-hosted, Sonarr/Radarr-style automation app for music videos: monitor artists, automatically
find and grab new music videos from YouTube and generic indexers (Torznab/Newznab + a torrent or
usenet client), and organize them into a media library for Plex/Jellyfin/Emby.

Status: **M1 (foundation)** — data model, CRUD API, and web UI shell for artists, music videos,
quality profiles, and root folders. No automated searching/downloading yet; see `docs/plan.md`
for the full build plan (M2 adds the YouTube + indexer/download-client pipelines).

vidarr is purely an orchestrator, like Sonarr/Radarr/Lidarr — it doesn't host, scrape, or
distribute content itself. It automates whatever indexers, download clients, and YouTube sources
you configure it to use.

## Local development

Requires Node 20+.

```bash
npm install
cp apps/server/.env.example apps/server/.env
npm run prisma:migrate
npm run --workspace apps/server prisma:seed
npm run dev:server   # http://localhost:7878
npm run dev:web      # http://localhost:5173 (proxies /api to the server)
```

## Docker

```bash
docker compose up --build
```

The app is served at `http://localhost:7878`. `/config` holds the SQLite database, `/media`
(mounted from `./media` by default) is where organized files will eventually be written once the
import pipeline (M2) lands.
