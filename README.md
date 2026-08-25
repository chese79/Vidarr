# vidarr

A self-hosted, Sonarr/Radarr-style automation app for **music videos**: monitor artists, automatically
find and grab new music videos from YouTube and generic indexers (Torznab/Newznab + a torrent or
usenet client), validate that what got downloaded is actually a real music video, and organize
everything into a media library for Plex/Jellyfin/Emby — including pushing playlists straight into
those apps.

vidarr is purely an orchestrator, like Sonarr/Radarr/Lidarr — it doesn't host, scrape, or
distribute content itself. It automates whatever indexers, download clients, YouTube sources, and
media-server connectors you configure it to use.

Licensed under AGPL-3.0-or-later — see [`LICENSE`](LICENSE) and [`NOTICE.md`](NOTICE.md) (vidarr's
domain model and some logic are adapted from the GPL-3.0-licensed Sonarr/Radarr/Lidarr projects).

## Status

Core pipeline (M1–M4) and the Plex/Jellyfin integration below are built and working. See
[`docs/plan.md`](docs/plan.md) for the full build log, design rationale, and the backlog of
not-yet-started ideas (concert videos, web-series content types, curated list import).

## Features

**Library & metadata**
- Add an artist by searching [IMVDb](https://imvdb.com); their video catalog (title, year,
  director, thumbnail) is pulled in automatically and kept in sync on a daily refresh job.
- Artist page mirrors IMVDb's own videography layout — thumbnails, director, chronological by year.
- Manual artist/video entry also works for anything IMVDb doesn't have.

**Finding & grabbing videos** — searched and grabbed automatically per video, in this priority order:
1. **IMVDb curated source** — IMVDb sometimes has an editor-verified exact YouTube video link on
   file; if so, that's grabbed directly, no search needed.
2. **VEVO** — an official VEVO-channel upload, if a heuristic YouTube search finds a plausible one.
3. **YouTube (heuristic)** — otherwise, the artist's own official channel upload.
4. **Torznab/Newznab indexer** — falls back to a scoped indexer search (`3020` "Audio > Video"
   category, plus a result-level filter) against your configured indexer(s) and download client
   (qBittorrent or SABnzbd).
- You can also subscribe to a YouTube channel/playlist directly (`YoutubeSource`) instead of relying
  on search.
- Every downloaded file is validated before it's accepted: `ffprobe` confirms it actually has a
  video stream, and `ffmpeg`'s `freezedetect` filter confirms there's real motion — catching
  audio-only rips and static-album-art "videos" that would otherwise slip through.
- Quality profiles control which qualities are allowed per artist and the upgrade cutoff; a
  scheduled job re-grabs a better allowed quality for anything below cutoff.

**Organizing the library**
- Configurable naming pattern (`{Artist Name}/{Artist Name} - {Video Title} ({Year}) [{Quality}]`
  by default), with a live preview in Settings.
- Every import also writes a Kodi/Jellyfin-style `.nfo` sidecar (title/artist/year/director) and a
  local thumbnail image next to the video file — so Jellyfin/Kodi read the exact metadata vidarr
  already has instead of re-guessing it from the filename, and playlist-push matching (below) stays
  reliable regardless of what quality tag ends up in the filename. Run "Regenerate library metadata
  files" on the System/Tasks page to backfill this for videos imported before this existed.
- Configurable transfer mode (hardlink / copy / move) and a minimum-free-space check before import.

**Plex / Jellyfin / Navidrome integration** — three separate points of contact, since "read from"
and "write to" a media server are different jobs with different data:
1. **Read artists into the watchlist** — add a Library Connector (Plex, Jellyfin, or
   Navidrome/Subsonic), sync it, and every artist you already listen to that vidarr doesn't yet
   track videos for shows up on the **Discover** page as a "You listen to this artist"
   recommendation (highest-confidence, always surfaced — listening to an artist never excludes them
   just because you don't have their videos yet). Discover also blends in similarity data from
   Last.fm / Spotify / MusicBrainz if you add API credentials for those.
2. **Push playlists back out** — build a playlist in vidarr from your downloaded videos, then push
   it to Plex or Jellyfin as a real playlist in their apps. This uses a *second*, separately-chosen
   library on the same connector (the "video library" picker on the Library Connectors page) —
   whichever Plex/Jellyfin section actually holds vidarr's organized video files — matched to each
   playlist item by artist + title. A push fully replaces the remote playlist rather than diffing
   it, to avoid drift.
   - Jellyfin's playlist API is well-documented and used as-is.
   - **Plex's playlist push is best-effort and not yet verified against a real Plex server** (none
     was available while building it) — Plex has no first-class "music video" item type, so
     matching falls back to an exact title search within whichever section you pick. Test it
     against your own server before relying on it, and expect to adjust the item-type filter in
     `apps/server/src/providers/library/plex.ts` once you see real item shapes.
3. **Standardized naming/library convention** — the `.nfo` + thumbnail sidecars above are what make
   (1) and (2) reliable: Jellyfin's scan picks up vidarr's exact artist/title rather than parsing it
   back out of a filename, and playlist push matches against that same exact text.

**Everything else you'd expect from an *arr app**: Calendar (recently added/still wanted), History
(append-only event log), a live Queue view, System/Tasks (per-job status + run-now), Settings
(naming pattern preview, transfer mode, IMVDb key, min free space).

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

The server needs `yt-dlp` and `ffmpeg`/`ffprobe` on `PATH` for the YouTube pipeline and content
validation. On Linux, `apt`/`pip` installs normally land on `PATH` already, so **no configuration
is needed** — same for Docker, which bundles both into the image. On Windows, a winget/pip install
often lands somewhere not on `PATH`; if so, point the server at them explicitly instead:

```bash
# Linux, if yt-dlp/ffmpeg aren't already on PATH:
YTDLP_PATH=/usr/local/bin/yt-dlp FFMPEG_PATH=/usr/bin/ffmpeg npm run dev:server

# Windows:
YTDLP_PATH="C:\path\to\yt-dlp.exe" FFMPEG_PATH="C:\path\to\ffmpeg.exe" npm run dev:server
```

`ffprobe` is assumed to live alongside `ffmpeg` (same directory) unless overridden separately via
`FFPROBE_PATH` — true for both a standard apt/winget install and the Docker image.

### Configuration (Settings page + connector/indexer pages, not env vars)

Nearly everything is configured at runtime through the UI and stored in the database, not via env
vars — matching Sonarr/Radarr's own model:

- **Settings** — IMVDb API key, naming pattern, transfer mode, minimum free space.
- **Indexers** — Torznab/Newznab base URL + API key; search is scoped to the music-video category.
- **Download Clients** — qBittorrent or SABnzbd host/credentials.
- **YouTube Sources** — subscribe a channel/playlist directly to an artist.
- **Library Connectors** — Plex/Jellyfin/Navidrome host + token; separately pick a *music* library
  (for reading artists) and a *video* library (for playlist push) per connector.
- **Recommendation Providers** — optional Last.fm/Spotify/MusicBrainz credentials for Discover.

## Docker

```bash
docker compose up --build
```

The app is served at `http://localhost:7878`. `yt-dlp` and `ffmpeg` are installed into the image at
build time, so no host setup is needed. `/config` (a named volume) holds the SQLite database,
`/media` (mounted from `./media` by default) is where organized files get written — point your
Plex/Jellyfin media-video library at that same folder on the host.
