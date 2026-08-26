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

## Web UI (React SPA, TanStack Query, polling for live queue progress)

Note: originally planned as SSE (see heading history) — M3 switched this to plain polling
(`refetchInterval`) since the queue monitor job itself only ticks every 20s; true push-based
streaming wasn't worth the added plumbing. See M3's entry below.

Current nav (`apps/web/src/App.tsx`): Library (Artists grid) · Artist detail (videos, monitor
toggle, manual search, per-artist YouTube Sources) · Add Artist (IMVDb search / manual — two modes,
no separate YouTube-URL mode) · Calendar · Discover (Plex/Jellyfin/Navidrome + Last.fm/Spotify/
MusicBrainz recommendations) · Import (bulk-add from a YouTube playlist URL) · Playlists (build
from downloaded videos, push to Plex/Jellyfin) · Queue (live progress via polling) · History ·
Quality Profiles · Root Folders · Library Connectors (Plex/Jellyfin/Navidrome CRUD + test/sync) ·
Indexers (CRUD + test-connection) · Download Clients (CRUD + test-connection) · System/Tasks (job
status, run-now, logs, "Regenerate library metadata files") · Settings (naming pattern with live
preview, transfer mode, IMVDb key, min free space).

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
- **YouTube playlist bulk import**: a new Import page — paste any YouTube playlist (or channel
  "Videos" tab) URL and bulk-add its videos to the wanted list, instead of adding one artist at a
  time. Per-video artist is guessed from the title's own "Artist - Title" convention, NOT the
  uploading channel — confirmed live against a real "Various Artists" label playlist where every
  video reported the same channel ("Builders Music") despite each one being a different performer;
  channel name is only a fallback for listings with no such title pattern (e.g. an official
  per-artist channel like R.E.M.'s, whose titles are bare song titles). Also fixed a real yt-dlp
  quirk found via the same live test: a channel's "Videos" listing doesn't populate the per-entry
  `channel`/`uploader` fields at all, only `playlist_channel`/`playlist_uploader` (a genuine
  multi-uploader playlist populates the former instead) — `listPlaylistVideos` now falls back
  through both pairs. Every row is reviewable/overridable before committing, since title-parsing
  this heuristic is inherently imperfect (same fundamental problem as Sonarr/Radarr's own
  release-title parsing) — manual review is the safety net, not perfect regex.
- **Import page review UI — grouped checkboxes, not a flat table**: candidates are grouped by
  resolved artist (`groupCandidates` in `ImportPage.tsx`), each group showing one "Add to watch
  list" checkbox (unchecked by default — importing a track doesn't imply you want that performer
  actively monitored going forward) plus a per-video "include" checkbox (checked by default) and an
  aggregate "Import Selected (n/total)" count. Backend mirrors this: `ImportArtistGroup` (one per
  performer, holding its own videos) replaced the earlier flat per-video selection list, so the
  watch-list flag is naturally per-artist rather than duplicated on every row.

**Cleanup pass — code + docs review, no new features**: a full review of the codebase (pipeline,
API layer, web frontend, docs) surfaced and fixed:
- **Schema**: removed dead `Tag`/`TagOnArtist` models and `Indexer.supportsRss`/`supportsSearch`/
  `DownloadQueueItem.outputPath` fields (never read or written anywhere); added `sourceRef` to
  `RecommendationSourceHitSchema` and `lastCheckedAt` to `RootFolderSchema`, which the server was
  already writing/returning but the shared type didn't describe.
- **API consistency**: a global `Prisma.PrismaClientKnownRequestError` (P2025) handler in
  `main.ts` now maps every PUT/DELETE-by-id route's "record not found" to a real 404 instead of a
  bare 500 — one fix covering all resources, rather than a per-route existence check. Added
  `UpdateIndexerSchema` and Zod validation to the two remaining routes that trusted a raw `as` cast
  (`bulkimport.ts` commit, `recommendation.ts` add). `artist.ts`'s PUT now surfaces a failed
  post-monitor metadata refresh to the caller (`metadataRefreshError`) instead of only logging it.
- **Pipeline dedup**: extracted `providers/library/util.ts` (shared `baseUrl()` +
  `createAuthedFetcher()`, since Plex/Jellyfin's HTTP handling differed only by header name) and
  `db/client.ts`'s `logActivity()` helper (replacing ~14 duplicated `prisma.activityLog.create`
  blocks). Fixed two ActivityLog severity/source inconsistencies (`grab.ts`'s recoverable
  queue-monitor failure was logged at `'error'` like every other job logs at `'warn'`;
  `metadataRefresh.ts`'s per-video and per-artist failures shared one indistinguishable source).
- **Frontend**: fixed a real bug in `ArtistDetailPage.tsx`'s search-results table — grab state was
  keyed by array index, which would mis-attribute "Grabbing…" to the wrong row if results ever
  re-sorted; now keyed by the release's own `downloadUrl`. Extracted a shared `VideoThumb`
  component (was duplicated in `ArtistDetailPage.tsx`/`PlaylistsPage.tsx`), converted
  `ReleaseSearchPanel`'s hand-rolled fetch to `useQuery` and `SystemTasksPage`'s backfill handler to
  `useMutation` (both now consistent with every other one-shot fetch/action in the app), added
  `htmlFor`/`id` pairs to `SettingsPage.tsx`'s form labels, and replaced `DiscoverPage.tsx`'s
  non-null assertions on `rootFolders.data![0]`/`qualityProfiles.data![0]` with a guarded error
  instead of a potential runtime crash on a stale-cache race.
- Deliberately left as-is: the `{ok:false}` vs bare `{error}` split on error responses (the web
  client only ever reads `body.error`, so this is cosmetic, not a bug); `artist.ts`'s PUT returning
  `{...updated, videosAdded, metadataRefreshError}` instead of a strictly-typed response schema
  (deliberate — these are optional side-channel signals, not core record fields).

**Filter-based playlist generation**: a "Generate from filters" panel on the Playlists page —
selectable factors (year range, genre, minimum play count, artist, specific video), each with its
own enable checkbox, combined via an AND/OR toggle (`matchMode: 'all' | 'any'`). One-time generation
(picks matching videos into a normal static Playlist), not a live/recomputing smart playlist — a
deliberate scope choice to reuse the existing Playlist model and push-to-Plex/Jellyfin flow as-is.
- **Genre**: new `Artist.genre`/`MusicVideo.genre` fields, user-editable directly (ArtistDetailPage
  header + Add Video form), auto-backfilled onto genre-less artists from a Jellyfin
  `LibraryArtist.genre` sync when names match, or explicitly "standard-matched" via a new
  `POST /artist/:id/match-genre` action that queries Spotify's real controlled-vocabulary
  `artist.genres` (the only enabled recommendation-provider with structured genre data — Last.fm's
  "tags" are free-text/user-submitted, MusicBrainz has none). Genre filtering does a substring match
  against artist OR video genre (so a broad term like "rock" matches a stored "album rock").
- **Play count**: real per-video sync against a connector's actual watch stats (`MusicVideoFile.
  playCount`), not the pre-existing per-artist `LibraryArtist.playCount` (which only ever fed
  recommendation-seed ranking). `LibraryConnectorProvider` gained `findLibraryItem()`, refactored out
  of the existing playlist-push item-matching code (Jellyfin's `UserData.PlayCount` / Plex's
  `viewCount` come free on the same search response used to resolve the item's id) — so playlist
  push and `POST /libraryconnector/:id/sync-play-counts` share one matching implementation per
  provider instead of two.
- Verified live: manual genre set/read on both Artist and MusicVideo; genre-match endpoint correctly
  404s with a clear message when no provider has structured genre data configured (Spotify wasn't
  set up in this environment — the fetch call itself is unverified against real Spotify credentials);
  six generation test cases against real data (year range in/out of bounds, genre substring match,
  AND vs OR combining a passing and a failing filter, artist-id filter) — all produced exactly the
  expected match/no-match result, confirmed via the actual created PlaylistItem rows, then cleaned up.

**Security review — no new features, hardening + real-CVE research**: researched actual published
Sonarr/Radarr/Lidarr/Prowlarr security advisories (not assumed from memory) before auditing vidarr's
own code, then fixed every real finding.
- **No authentication (the headline finding)**: every `/api/v1/*` route was completely open —
  combined with `host: '0.0.0.0'` and permissive CORS, anyone on the network, or any webpage the
  user's browser visited, could read or change everything, including every stored third-party
  credential. This was the original M1 plan ("single-user, API-key style auth, matches Sonarr/
  Radarr's own model") that never actually got built. Fixed: `Settings.apiKey`, generated on first
  boot and printed to the server console (same bootstrap approach Sonarr/Radarr use with
  config.xml — there's no way to fetch a key you don't have through an API that requires it), a
  global `onRequest` hook requiring it (constant-time compare) on every route except `/health`, a
  `POST /config/regenerate-api-key` rotation action, and a web-side `ApiKeyGate` (prompts once,
  persists in localStorage, re-prompts on any 401 via a `vidarr:unauthorized` window event) — see
  `apps/server/src/pipeline/auth.ts` and `apps/web/src/components/ApiKeyGate.tsx`.
- **Path traversal via Artist/MusicVideo name (CWE-22)** — same vulnerability *class* as Sonarr's
  own [CVE-2026-30976](https://github.com/Sonarr/Sonarr/security/advisories/GHSA-h393-v5hm-6h8f),
  though a file-*write* here rather than their file-*read*: `sanitizeForPath` stripped path
  separators but not a segment that collapsed to exactly `.`/`..` — an Artist named literally `..`
  (paired with the default naming format's bare `{Artist Name}` first segment) caused imported
  files to land outside the configured root folder. Fixed in two independent layers: `sanitizeForPath`
  now neutralizes bare `.`/`..`/empty segments, and `import.ts` separately verifies the resolved
  destination is still inside the root folder before writing, on the theory that file placement is
  a security boundary that shouldn't depend on a single upstream check being perfect.
- **Vulnerable dependencies** (`npm audit`): `@fastify/static` had two real advisories in the exact
  same class as the Sonarr path-traversal CVE above (confirmed live post-upgrade: a raw,
  non-normalized `../../../../etc/passwd` request against the built SPA now throws @fastify/static's
  own `forbiddenPathError` → 403, not a leak); `fastify` itself had an `X-Forwarded-Proto/Host`
  spoofing issue (the same header-trust category as Sonarr's auth-bypass CVE, though vidarr's auth
  hook never reads forwarded headers at all, so it wasn't independently exploitable here — fixed by
  the upgrade regardless); `fast-xml-parser`'s CVE was in `XMLBuilder`, which vidarr never imports
  (confirmed via grep before treating it as lower-priority); `react-router-dom`'s open-redirect CVE
  needs an attacker-controlled redirect target, which vidarr's routing never has. Upgraded all four
  plus `vite` (a dev-server-only advisory) anyway — `npm audit` went from 6 vulnerabilities (3
  high) to 0. All were major-version bumps; verified via full rebuild + live smoke test of every
  route category (SPA serving, SPA fallback, static assets, API auth) rather than just a green
  build.
- **Global error handler didn't respect a thrown error's own `statusCode`** — found while verifying
  the @fastify/static upgrade actually worked: its real 403 was being flattened to a generic 500.
  Fixed to surface any `< 500` statusCode a Fastify plugin sets, only defaulting to 500 (and
  logging server-side) for genuinely unexpected errors.
- **Docker container ran as root** — added a fixed-uid (1000) non-root user, `chown`'d `/config`
  and `/media` before the `VOLUME` declarations so a named volume inherits correct ownership;
  documented the one real wrinkle (a bind-mounted host directory keeps the host's own ownership,
  so it needs a manual `chown` if it isn't already uid 1000).
- **Removed the CORS registration entirely** rather than narrowing its origin list — the browser
  never makes a cross-origin request to vidarr's API in any real deployment (Vite's dev-server
  proxy in development, same-origin static serving in production), so a permissive CORS policy was
  pure attack surface with no corresponding feature.
- Confirmed clean, no fix needed: no raw SQL anywhere (Prisma parameterizes everything); every
  `child_process.spawn` call (yt-dlp, ffmpeg, ffprobe) uses an args array with no `shell: true`, so
  there's no command-injection surface from artist/title strings; no `dangerouslySetInnerHTML` or
  `eval`/`new Function` anywhere in the web app.

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

- **Curated list import (YouTube playlist done; IMVDb list source still open)**: bulk-add videos from a named list rather than one at a time. The YouTube-playlist half is built — see "YouTube playlist bulk import" below. An IMVDb-sourced equivalent (e.g. a "best of the year" list/chart page) remains unbuilt: IMVDb's API has no documented "lists" endpoint (only per-artist video catalogs and text search, see providers/metadata/imvdb.ts), so this needs a specific real IMVDb URL to inspect before assuming any such data is even available.
- **Additional content types — explicitly on hold until music videos are solid**: concert videos (Newznab indexers surface a lot of these already, per real search results — worth a dedicated content type/category rather than treating them as noise), and web series like NPR's Tiny Desk Concerts (recurring episodic content, closer to a YouTube-playlist-as-series model than a single music video). Would need their own MusicVideo-equivalent type or a `contentType` field, separate matching rules, and probably separate quality/naming handling. User's explicit instruction: don't start this until the core music-video pipeline (search precision, YouTube-first matching) is dialed in.
