# vidarr — a Sonarr/Radarr-style automation app for music videos

## Context

The user wants a self-hosted "*arr"-family app (Sonarr/Radarr/Lidarr's category) but for music videos: a monitored library of wanted/owned music videos that automatically finds and downloads new content, organizes it into a media library folder for Plex/Jellyfin/Emby, with a full web UI. No comparable tool exists off-the-shelf for music videos specifically, so this is a from-scratch build.

Decided scope:
- **Full pipeline**, both sources built together from the start: (1) generic Torznab/Newznab indexers + a torrent/usenet download client (qBittorrent/SABnzbd) — the same orchestration pattern real Sonarr/Radarr/Lidarr use — and (2) YouTube channel/playlist monitoring via `yt-dlp`.
- **Stack**: Node.js + TypeScript backend, React frontend, SQLite via Prisma.
- **Metadata**: IMVDb (imvdb.com) API as primary source for artist/video/artwork metadata; user will register for an API key before M2. Manual entry and YouTube-native (title from the video itself) as fallbacks for artists not in IMVDb.
- **Deployment**: Docker from the start (Dockerfile + docker-compose), not just a local Node process. This also solves distributing `yt-dlp`/`ffmpeg` — bundle them into the image at build time rather than requiring the host to have them on PATH.
- **Location**: new project at `C:\Users\ChrisChesebro\Documents\vidarr` (currently empty/doesn't exist).
- **Auth**: single-user, API-key style auth for v1 (matches Sonarr/Radarr's own model) — no multi-user accounts.

**Legal/ToS note** (surfaced once, not a blocker): vidarr, like Sonarr/Radarr/Lidarr, is purely an orchestrator — it doesn't host, scrape, or distribute content. It automates user-configured indexers/download clients and YouTube sources the user points it at. YouTube's ToS restricts downloading outside its own offline features; `yt-dlp` itself is legal software, but how it's used is on the user, same as any *arr + indexer combination.

## Architecture

Single Node process (API + scheduler + job execution in one), React SPA served statically by that same process in production, SQLite (WAL mode) via Prisma. No Redis/external queue for v1 — an in-process cron + lightweight job runner is sufficient for a single-user, low-throughput app (explicitly flagged as a deliberate v1 simplification, not an oversight — BullMQ+Redis is the natural upgrade path if ever needed).

```
apps/server (Fastify + TS)          apps/web (React + Vite)
 ├─ api/            REST routes      ├─ pages/     one per screen
 ├─ providers/                       ├─ components/
 │   ├─ indexer/    Torznab client   └─ api/        typed fetch client
 │   ├─ downloadclient/  qBittorrent/SABnzbd adapters
 │   ├─ youtube/    yt-dlp child-process wrapper
 │   └─ metadata/   IMVDb client + manual fallback
 ├─ pipeline/       shared import/rename/organize logic
 ├─ scheduler/      cron job registry + runner
 └─ db/             Prisma client + repositories
packages/shared-types   DTOs shared between server and web
docker/                 Dockerfile (bundles yt-dlp + ffmpeg), docker-compose.yml
```

**Source abstraction** — the seam that lets both pipelines feed the same downstream logic:
```ts
interface SearchResult {
  provider: 'indexer' | 'youtube';
  providerId: string;
  title: string;
  quality: QualityGuess;
  sourceUrl: string;
}
interface SourceProvider {
  search(query: SearchQuery): Promise<SearchResult[]>;
  grab(result: SearchResult, target: MusicVideo): Promise<GrabHandle>;
}
```
- `IndexerProvider`: Torznab/Newznab search → sends the .torrent/.nzb to a `DownloadClient` adapter (qBittorrent or SABnzbd HTTP API) → a queue-monitor job polls the client for completion.
- `YoutubeProvider`: search = ad hoc `yt-dlp ytsearch:` or enumerate a subscribed channel/playlist; grab = spawn `yt-dlp` as a child process with `--newline` progress parsing, downloading straight into a staging folder (no download client involved).
- Both feed the **same import pipeline** once a file lands on disk.

## Domain Model (Prisma schema, conceptual)

- **Artist** — name, sortName, imvdbArtistId?, monitored, rootFolderId, qualityProfileId, images, tags
- **MusicVideo** — artistId, title, imvdbVideoId?, youtubeVideoId? (unique key alongside artistId+normalizedTitle for cross-source dedup), releaseYear, director?, monitored, hasFile
- **MusicVideoFile** (1:1 with MusicVideo) — path, quality, size, mediaInfo JSON
- **QualityProfile** / **Quality** — ordered allowed qualities + upgrade cutoff (mirrors Sonarr's model)
- **RootFolder** — path, cached free space, accessible flag
- **Indexer** — name, implementation, baseUrl, apiKey, categories, enabled, priority
- **DownloadClient** — name, implementation (qBittorrent/SABnzbd), host/port/credentials, category label, enabled, priority
- **YoutubeSource** — type (channel/playlist/single), url/channelId, artistId, monitored, lastPolledAt, yt-dlp format string
- **DownloadQueueItem** (transient) — musicVideoId, sourceType, sourceRef, downloadClientId?, status, progress, outputPath
- **History** (append-only) — musicVideoId, eventType (grabbed/imported/failed/deleted), date, JSON data
- **ActivityLog** — level, source, message, date (app/job health, not per-video)
- **Settings** — naming pattern tokens, transfer mode (hardlink/copy/move), min free space
- **Tag** — many-to-many with Artist/Indexer/DownloadClient

Dedup rule: canonical identity is `(artistId, normalizedTitle)`; `imvdbVideoId`/`youtubeVideoId` are optional secondary keys on the same row so a video found via either source resolves to one record. Fuzzy title matching (normalized string compare) is the fallback matcher when a grabbed release's title doesn't cleanly map to a known record — same technique Sonarr uses for scene-name parsing.

## Import & Organization Pipeline (shared by both sources)

1. Locate completed output (download client reports path via API for indexer grabs; yt-dlp's `--print after_move:filepath` for YouTube grabs).
2. Identify the actual video file (largest video file above a size threshold, excluding samples).
3. Match back to the `MusicVideo` record — usually direct via `DownloadQueueItem.musicVideoId`; fuzzy-match fallback for manually-dropped files.
4. Parse quality (release-title tokens for indexer grabs; deterministic from the yt-dlp format string for YouTube).
5. Rename per the naming pattern (`{Artist Name}/{Artist Name} - {Video Title} ({Year}) [{Quality}]`).
6. Move into the root folder — hardlink-then-delete-source when same filesystem (keeps torrent seeding, saves space), plain move/copy fallback otherwise; configurable transfer mode.
7. Update DB (`MusicVideoFile`, `hasFile=true`, `History` row), remove the queue item.
8. On any match/parse failure: surface as "Manual Import Required" in the Activity UI rather than silently dropping it.

## Scheduler (in-process, no external infra)

`croner` (TS-native cron) + a minimal per-lane job runner, job status/history persisted in a `ScheduledTask` table so the UI can show last-run/next-run and survive restarts.

| Job | Interval | Purpose |
|---|---|---|
| Indexer RSS sync | 15–20 min | Poll enabled indexers for new releases matching the wanted list |
| YouTube channel/playlist poll | 30–60 min | `yt-dlp --flat-playlist --dump-json`, diff against known `youtubeVideoId`s |
| Download queue monitor | 15–30 sec | Poll download clients + yt-dlp child processes, trigger import on completion |
| Missing/wanted backlog search | daily / manual | Search all providers for monitored videos with `hasFile=false` |
| Root folder health check | hourly | Refresh free space, flag inaccessible paths |
| Library metadata refresh | daily | Re-sync from IMVDb (new videos, corrected metadata) |

## Web UI (React SPA, TanStack Query, SSE for live queue progress)

Library (Artists grid) · Artist detail (videos, monitor toggle, manual search) · Add Artist (IMVDb search / YouTube channel-playlist URL / manual) · Calendar · Activity Queue (live progress via SSE) · History · Indexer settings (CRUD + test-connection) · Download Client settings (CRUD + test-connection) · YouTube Sources settings · Quality Profiles · Root Folders · General/Media Management settings (naming pattern with live preview, transfer mode) · System/Tasks (job status, run-now, logs).

REST routes are 1:1 with the domain model above, under `/api/v1/...`.

## Docker Packaging

- `Dockerfile`: Node base image, installs `yt-dlp` + `ffmpeg` at build time (pinned versions), builds `apps/server` and `apps/web`, serves the SPA statically from the server process.
- `docker-compose.yml`: vidarr service + volume mounts for the SQLite DB file, config, and the media root folder(s); document how to point it at an existing qBittorrent/SABnzbd instance (host networking or shared network).
- SQLite file lives on a mounted volume so it survives container recreation.

## Build Plan (both pipelines built together, per user's choice)

**M1 — Foundation**
- npm workspaces monorepo scaffold (`apps/server`, `apps/web`, `packages/shared-types`), base tsconfig/eslint.
- Prisma schema (full domain model above) + initial migration.
- Dockerfile + docker-compose skeleton (build succeeds, container runs, empty app boots).
- Server: CRUD REST routes for Artist, MusicVideo, QualityProfile, RootFolder, Settings (manual entry only, no external providers yet).
- Web: app shell/nav, Library screen, Artist detail (manual add/edit), Quality Profile + Root Folder settings screens.

**M2 — Both source pipelines + shared import**
- `SourceProvider` interface + IMVDb metadata client wired into "Add Artist" search.
- `IndexerProvider` (Torznab/Newznab) + `DownloadClient` adapters (qBittorrent first, SABnzbd second), settings CRUD + test-connection.
- `YoutubeProvider` (yt-dlp child-process wrapper, channel/playlist polling, progress parsing), YouTube Sources settings CRUD.
- Shared import/rename/organize pipeline (§ above) consuming both sources.
- Download queue monitor job wired to both download clients and yt-dlp processes.

**M3 — Scheduler, live UI, calendar/history — done**
- Job registry (queue monitor 20s, YouTube poll 45m, backlog search 6h, root folder health 1h, metadata refresh 24h) + System/Tasks screen with per-job Run Now. Plain `setInterval` per job, not the originally-proposed `croner` — these are all fixed-interval jobs, not calendar-cron schedules, so a cron-string library added nothing.
- Queue page live-updates via polling (`refetchInterval`) rather than SSE — simpler, and sufficient given the queue monitor itself only ticks every 20s; true push-based streaming wasn't worth the added plumbing here.
- History and Calendar screens. Calendar is deliberately scoped to "recently added, still wanted" (newest first) rather than a real release calendar — vidarr only has a release *year* (IMVDb/YouTube don't reliably give day-level music-video dates), so a day-by-day calendar isn't honestly buildable on this data.
- Missing/Wanted Backlog Search auto-picks the best result (highest allowed quality, then seeders) and grabs it automatically — no user selection step, unlike the manual per-video Search panel from M2.
- **Added, not originally scoped**: content validation before any import accepts a file — checks (via ffprobe) that it actually has a video stream at a real resolution, and (via ffmpeg's freezedetect filter) that it has actual motion, not just album art held static for the whole song. Catches audio-only rips and static-image "videos" that would otherwise pass every earlier check. Applies to both grab pipelines.

**M4 — Quality upgrades, polish, hardening — done**
- Quality-profile cutoff/upgrade logic: scheduled job (12h) re-grabs a better allowed quality for any owned file below its profile's cutoff, reusing the backlog-search grab machinery with a minimum-quality floor. The shared import pipeline deletes the old file and logs the previous path once a replacement lands.
- Naming-pattern live preview in Settings, backed by the same renderer the server uses for real imports (moved into `packages/shared-types` so there's one implementation, not two). Transfer-mode setting already existed since M1.
- Disk-space pre-check before any import, using the free-space figure the M3 health-check job maintains.
- Retry-with-backoff on qBittorrent/SABnzbd calls, a daily Log Cleanup job (90-day retention on ActivityLog/History). Notification webhooks (Discord/Plex-refresh) remain deferred/optional, not built — no request for them yet.

**Post-M4 — search precision, then Plex/Jellyfin integration — done**
- **Newznab category scoping**: real live testing surfaced automatic grabs matching wrong content
  (a TV episode and a movie with a similar title to the wanted song) because indexer search had no
  category filter. Fixed: search defaults to Newznab category `3020` ("Audio > Video", confirmed
  live via NZBGeek's `t=caps` response) plus a result-level post-filter on the category the indexer
  itself reports.
- **YouTube-first automatic search**: category scoping alone wasn't enough — some indexer results
  (radio specials, concert recordings) lack clean category metadata and still slipped through.
  Reordered automatic search to try YouTube (heuristic match: official/VEVO channel, "official
  video" in the title, artist name in the channel or title) *before* falling back to indexer search,
  per user's explicit direction (`youtubeMatch.ts`, `autoSearch.ts`).
- **VEVO tiering**: within the YouTube heuristic match, VEVO-channel candidates are preferred over
  an artist's own channel when both are plausible matches — VEVO is the closer analogue to an
  "official" release for major-label artists.
- **IMVDb curated source — new top-priority tier**: IMVDb's per-video detail endpoint
  (`?include=sources`) sometimes carries an editor-verified exact YouTube video id (confirmed live
  against Radiohead's "Identikit"). When present, this is grabbed directly ahead of the VEVO/YouTube
  heuristic tiers and the indexer fallback — an exact match beats any heuristic. Fetched in the same
  call as director info (`providers/metadata/imvdb.ts`'s `getVideoDetails`).
- **Videography-style library UI**: Artist Detail's video list redesigned to mirror IMVDb's own
  videography page — thumbnails, director, chronological-by-year — per user request, alongside a
  Monitored toggle, Select All/Deselect All, and bulk "Search Selected".
- **Standardized naming/library convention**: every import now also writes a Kodi/Jellyfin-style
  `.nfo` sidecar and a local thumbnail image next to the video file (`pipeline/libraryConvention.ts`)
  — independent of Sonarr/Radarr/Lidarr, no equivalent to port. This makes Jellyfin's own library
  scan pick up vidarr's exact artist/title/year/director instead of re-parsing the filename, which
  in turn makes playlist-push matching (below) reliable regardless of the `[Quality]` tag in the
  filename. A manual "Regenerate library metadata files" button on System/Tasks backfills this for
  videos imported before it existed.
- **Playlist creation + push to Plex/Jellyfin**: new `Playlist`/`PlaylistItem`/`PlaylistSync` models
  and a Playlists page — build a playlist from downloaded (`hasFile=true`) videos, then push it to
  any enabled Plex/Jellyfin connector as a real playlist in that app. Requires picking a *second*,
  separate library per connector (`LibraryConnector.videoLibraryId`, chosen via a new
  `listSections()` provider call) — deliberately distinct from `musicLibraryId` (used to read
  artists for Discover), since the library holding vidarr's organized video files is not the same
  library used to see what you already listen to. A push is a full replace (delete remote playlist,
  recreate) rather than a diff, matching this codebase's existing "manual button, no incremental
  sync" pattern for connectors. Jellyfin's playlist API (`POST /Playlists`) is well-documented and
  used as-is; **Plex's playlist push (`providers/library/plex.ts`) is unverified against a real Plex
  server** — none was available while building it — since Plex has no first-class music-video item
  type, matching falls back to an exact title search within the chosen section. Verify against a
  real server before relying on it.
- Subsonic/Navidrome has no playlist-push support — no music-video concept in that protocol; it
  remains read-only (artist sync for Discover) as originally scoped.

## Verification

- After M1: `docker compose up` boots the app; can create an Artist/MusicVideo/QualityProfile/RootFolder manually through the UI and see them persisted (`docker compose down && up` retains data via the SQLite volume).
- After M2: adding a real IMVDb-matched artist plus a YouTube channel URL results in an actual downloaded, renamed, correctly-placed file in the configured root folder within one polling interval; adding a real indexer + qBittorrent instance results in a manual search successfully grabbing and importing a release end-to-end.
- After M3: Activity Queue shows live progress during an active grab; History records the event; a scheduled job's "last run" timestamp updates on its own without manual triggering.
- After M4: forcing a lower-quality file to exist, then finding a higher-quality release, triggers an automatic upgrade-and-replace; naming-pattern preview in Settings matches the actual output filename produced by a subsequent import.
- After Post-M4: a video with an IMVDb-sourced `youtubeVideoId` grabs directly with no search; an
  import writes a matching `.nfo` + thumbnail next to the video file; a playlist built from
  downloaded videos pushes successfully to a real Jellyfin server (Plex push still needs live
  verification against a real Plex server, per the note above).

## Backlog / future ideas (not scheduled to a milestone yet)

- **Curated list import**: bulk-add artists/videos from a named list rather than one at a time — e.g. VMA nominees by year, Grammy Award winners by year. Would need a source for the list data itself (no obvious API; likely hand-curated or scraped) and a bulk "add all matched artists" flow reusing the existing Add Artist (IMVDb-search) pipeline.
- **Additional content types — explicitly on hold until music videos are solid**: concert videos (Newznab indexers surface a lot of these already, per real search results — worth a dedicated content type/category rather than treating them as noise), and web series like NPR's Tiny Desk Concerts (recurring episodic content, closer to a YouTube-playlist-as-series model than a single music video). Would need their own MusicVideo-equivalent type or a `contentType` field, separate matching rules, and probably separate quality/naming handling. User's explicit instruction: don't start this until the core music-video pipeline (search precision, YouTube-first matching) is dialed in.
