# Deployment

### Artist video actions: local-only release

Migration `20261016220000_artist_video_actions` adds the live/concert flag, durable deletion deadlines/attempts/retry state,
two General preferences and a minimal independent deletion ledger. Existing settings default to
warning on and rediscovery allowed. No migration deletes media or revisits existing owned files.
Back up configuration with the offline cutover helper and recreate only Vidarr, retaining exact
configuration/media/staging mounts and the rollback container. The Pending Video Deletions job checks due work every minute; a five-minute grace period precedes deletion and failures/playback defer it another 40 minutes. Run tests against fixture files and
mock server APIs; do not exercise Delete on real library media during deployment verification.

For this user-authorized local-only release, squash merge with `[skip ci]` in the merge subject to
skip the normal public-image workflow, then rebuild/tag/deploy a local image from the merged commit.
Do not push or replace public image tags. The publishing workflow itself remains unchanged for
subsequent ordinary releases. Verify health, migration, preserved ownership/queue records and both
preference defaults after cutover.

### Validation/Quality release

Apply additive migration `20261016200000_validation_policies` through normal startup. It adds
typed JSON settings storage and a persisted queue source category. Existing settings, quality
profiles, queue positions and IDs remain intact. Existing queue sources are canonical only when
an exact provider/URL match is accepted, confirmed and authoritative/verified; all others retain
full checks by default. Policy is read when validation starts, including existing queued work.
No historical owned-file rescan is triggered. Back up configuration before migration and recreate
only Vidarr; preserve all media/staging mounts. Old source versions tolerate the additive columns.
The combined page is `/validation-quality`; old `/quality-profiles` links redirect automatically.
Release verification: Node 22 production shared/server/web builds passed, all 758 server tests
(93 files) and 52 web tests passed. The complete server run used isolated memory-backed SQLite
and 30-second deadlines; an earlier disk-backed run was replaced after a loaded fixture timed out.
The public Docker publisher rebuilds `latest` and commit-specific tags after merging to main.

### YouTube Music discovery

Before replacement, stop only Vidarr and make an offline private configuration backup. On Docker
Desktop, copy the SQLite database and its WAL/journal sidecars together, then recover and run
`PRAGMA quick_check` against the writable backup copy. Do not run recovery against the source or
omit its WAL. Bound the backup operation and restore the original service if it fails; a read-only
SQLite online backup can stall against the Windows bind mount. Preserve all mounts and the old
container for rollback. Media and staged downloads are not copied or removed during deployment.

Rebuild/recreate only Vidarr, preserving configuration, media and persistent staging mounts.
This revision needs no schema migration, cookies reset or other-service restart. Existing manual
review decisions and canonical IDs remain intact. Use an artist's Refresh all sources to collect
Music shelves and official playlists immediately; normal monitored-channel polling also uses the
new discovery. Automatic admission performs bounded sample validation and creates unmonitored
catalog entries, not full download requests. Uncertain results remain in Video Review.
Public Music page/browse requests have 20-second deadlines; playlist and sample operations use
the existing yt-dlp deadlines and private cookie snapshots. Incomplete traversal retains partial
results and triggers the normal collection retry; only complete scans advance channel success.
Motion samples select a low-resolution video-only stream when available, with a combined-stream
fallback, and retain the 20-second section limit. A sample extraction failure remains reviewable.
The Docker image uses Debian's dynamically linked `/usr/bin/ffmpeg` for remote sample extraction
because the bundled static binary crashed on real YouTube HTTPS/HLS inputs. This adds the Debian
FFmpeg package and its dependency footprint. Local full-file validation/merging retains the
existing static tools and thread limits. `SAMPLE_FFMPEG_PATH` overrides only the sample extractor;
outside Docker it defaults to the existing `FFMPEG_PATH`/PATH behavior.
See [process flows](process-flows.md#youtube-music-official-discovery-2026-10-16).

### SQLite access and download ordering

The application uses one Prisma SQLite connection (`connection_limit=1`) to serialize API,
source-collection and background queue database work. Network requests and transfers remain
concurrent. Runtime connection URLs default to `socket_timeout=15` and `pool_timeout=30` seconds;
explicit timeout parameters are preserved. WAL and the 15-second busy timeout remain enabled at
startup, now on the same connection used for subsequent operations. Keep transactions short and
use their supplied transaction client for every query inside them. Failed source collections
retain existing data and remain eligible for the normal ten-minute retry or Refresh all sources.

The additive `20261016170000_download_queue_order` migration adds a queue-position column and
index. Existing requests default to zero and retain added-time/ID FIFO order. Manual reorder
normalizes waiting positions below zero, leaving subsequently added requests at the end.
Queue and the atomic transfer claim use position, added time and ID in the same order. Reorder
operations write bounded batches inside one transaction to avoid a database round trip per item.
Controls affect waiting work only; active transfers, uncertain submissions, processing and
delivery confirmation retain their existing behavior. Normal startup applies the migration;
no configuration-volume or media changes are needed.

### Download resource limits and recovery

Full-file motion validation uses one shared worker and one filter thread. Decode threads default
to two for HD (width >=1280 or height >=720) and one for SD. The configured download limit governs
network transfers; a separate processing worker validates/imports completed files. The default
pipeline capacity is the transfer limit plus three reservations, including unfinished transfers,
unresolved external submissions and processing files. This bounds staged work and reserves capacity
before transfers finish. New transfers pause when staging free space is below Minimum Free Space MB.
Required source/content validation and target-server confirmation remain intact.

Optional environment tuning:

- `DOWNLOAD_PIPELINE_CAPACITY`: total acquisition reservations, 1–200; effective capacity is never
  lower than the configured transfer limit. Default: transfer limit + 3 (six with three transfers).
- `YTDLP_CONCURRENT_FRAGMENTS`: 1–8, default four; applies to supported DASH/HLS fragment transfers.
- `VALIDATION_DECODE_THREADS`: 1–4; overrides adaptive HD/SD defaults while retaining one worker.

Partial downloads and completed staging paths persist across restart. A committed import records
its queue ID atomically, preventing duplicate acquisition after a crash between import and queue cleanup.
Queue/result timing details separate format setup, transfer, merge/post-processing, processing wait,
full validation and import. The rate is yt-dlp's last reported valid transfer rate, not an average.

Read-only 20-second benchmarks on two recent HD files under the running workload measured average
one/two-thread elapsed times of 7.73/7.06 seconds (AV1, 1480x1080) and 11.68/8.03 seconds
(VP9, 1920x1080). SD samples did not improve consistently. These short, noisy comparisons informed
the adaptive defaults; they do not predict end-to-end speedup. Production validation still checks
the full file, with unchanged motion thresholds and one filter thread.

Optional container environment overrides are `DOWNLOAD_TIMEOUT_MS` (default 1800000),
`EXTRACTOR_TIMEOUT_MS` (600000), `VALIDATION_TIMEOUT_MS` (900000), and `PROBE_TIMEOUT_MS` (30000).
Values must be positive milliseconds; invalid values use the defaults. Hung child processes receive
graceful termination followed by forced termination after five seconds. Existing
`PROVIDER_TIMEOUT_MS` (15000) also bounds download-client and indexer requests; thumbnail requests
have a fifteen-second deadline. Transport failures during external submission remain unresolved
until verified, since a timeout does not prove that the client rejected the job.

Successful imports schedule a per-connector refresh outside the acquisition slot. Notifications
are batched over five seconds and spaced at least thirty seconds apart. Pending-import
reconciliation retries interrupted/failed notifications and confirms exact target-server ownership.
Move imports link same-filesystem video bytes during staging, retaining the source until commit;
cross-device/unsupported links copy safely. Rollback and supplied metadata preservation remain unchanged.

When recreating a container with active acquisitions, preserve its `STAGING_DIR` (default
`/tmp/vidarr-staging`) as well as configuration and media mounts. Restore partial downloads and
completed staging bundles with their original ownership before starting the replacement; yt-dlp
can reuse these files when the persistent queue resumes. Retain the previous container and a
database backup for rollback. A persistent staging mount is recommended for routine deployments.
Docker copies generated application/Prisma assets with the non-root runtime owner. Installed
dependencies remain readable without a recursive ownership pass; `/config` and `/media` retain
their runtime owner. Existing bind-mount permissions remain the administrator's responsibility.

Four ways to run vidarr, in order of how much setup they require. Pick one.

- [Docker](#docker) — recommended; bundles `yt-dlp`/`ffmpeg`, no host setup.
- [Local development](#local-development) — for working on vidarr itself.
- [Native Linux (systemd)](#native-linux-systemd) — a persistent service without Docker.
- [Native Windows (service wrapper)](#native-windows-service-wrapper) — same, on Windows.

Every path shares the same first-run behavior: vidarr generates an API key on first
boot and prints it to its own console/log output — copy that value into the web UI's
key prompt the first time you load it (see [`README.md`](../README.md#first-run-the-api-key)
for the full explanation and how to recover a forgotten key).

Every path also shares the same config loading: the server reads `apps/server/.env`
itself (found relative to its own file location, not the directory you launch it
from — so it works the same whether you run `node dist/main.js` from `apps/server`
or from anywhere else), and a real environment variable (set by Docker's `ENV`
instructions or systemd's `EnvironmentFile=`) always takes precedence over the same
key in `.env`. `WEB_DIST_PATH` only needs to be set explicitly when the built web
assets live somewhere other than the normal `apps/web/dist` next to the server —
Docker and the paths below all work without it.

## Docker

### Tester release verification

Main publishes `ghcr.io/chese79/vidarr:latest` and a full Git commit SHA tag through
the repository's **Publish Docker image** workflow. Check that the workflow succeeded for
the revision being tested; use the SHA tag when a reproducible version is needed.
Source-based Compose installations use `docker compose up -d --build vidarr` after pulling updates.
Keep the existing `/config` and media mounts when upgrading.

The October 10, 2026 release validation passed all 667 server and 33 web tests under Node 22,
plus the production Docker build. An isolated empty-config container successfully applied all
34 migrations, exposed first-run setup, closed bootstrap-key access after authenticated use,
served API/UI/logo assets, ran as uid 1000 and provided working `yt-dlp`, `ffmpeg` and `ffprobe`.
External provider behavior still depends on the tester's configured services and credentials.

### Configuration

To scan Picard tags directly, mount the audio library read-only into the Vidarr container and enter
that container path as the connector's **Embedded music tag path**. For example, add
`/host/music:/music:ro` under the Vidarr service volumes and configure `/music`. Vidarr reads tags
with `ffprobe`; it never modifies audio files.

```bash
docker compose up --build
```

- App: `http://localhost:3434`
- `/config` (named volume) holds the SQLite database; `/media` (bind-mounted from
  `./media` by default) is where organized files get written — point Plex/Jellyfin's
  video library at that same host folder.
- Configure Vidarr Root Folders using the container side of that mount (`/media` by default).
  Never enter a Windows host path such as `D:\media` into a Docker-hosted Vidarr. For a custom
  `D:\media:/mnt/d/media` mount, the Root Folder is `/mnt/d/media`.
- `yt-dlp[default]` (including its matching EJS challenge solver) and `ffmpeg` are installed
  into the image at build time. Vidarr explicitly enables its Node 22 runtime for yt-dlp.
  Native installations must also install `yt-dlp[default]` and run Vidarr under Node 22 or newer.
  A private-video error means the source is inaccessible; use an accessible source or ask the
  uploader to grant access. JavaScript runtime support does not change video permissions.
- The container runs as a fixed non-root user (uid/gid 1000). If you bind-mount a host
  directory for `/media` instead of using a named volume, make sure it's writable by
  uid 1000: `sudo chown -R 1000:1000 ./media`.
- **Upgrading an existing deployment** created before the non-root change: the named
  `/config` volume will still be root-owned from the previous root-run container. Fix
  it once with:
  ```bash
  docker compose run --rm --user root vidarr chown -R 1000:1000 /config /media
  ```
  before starting the updated image.
- Get the API key from the container logs:
  ```bash
  docker compose logs vidarr | grep -A2 "Generated a new API key"
  ```

## Local development

For working on vidarr itself (not a deployment target) — see
[`README.md`](../README.md#local-development) for the full setup: `npm install`,
copying `.env.example`, running migrations, and `npm run dev:server` /
`npm run dev:web`.

## Native Linux (systemd)

Runs the built app directly as a system service — no Docker.

### 1. Get the code and install host dependencies

```bash
git clone <your-vidarr-repo-url> /opt/vidarr
cd /opt/vidarr
sudo apt update
sudo apt install -y ffmpeg python3 python3-pip
pip3 install --break-system-packages 'yt-dlp[default]'
```
(`ffprobe` ships with the `ffmpeg` apt package.)

### 2. Create a dedicated non-root user

```bash
sudo useradd -r -m -d /var/lib/vidarr -s /usr/sbin/nologin vidarr
sudo mkdir -p /var/lib/vidarr/config /var/lib/vidarr/media
sudo chown -R vidarr:vidarr /var/lib/vidarr /opt/vidarr
```
`/var/lib/vidarr/media` is where organized files land — point Plex/Jellyfin's video
library at this path.

### 3. Build

```bash
cd /opt/vidarr
sudo -u vidarr npm install
sudo -u vidarr npm run build
```
Runs the root `build` script: `packages/shared-types` → `apps/server` (→
`apps/server/dist/`) → `apps/web` (→ `apps/web/dist/`).

### 4. Environment file

```bash
sudo -u vidarr tee /opt/vidarr/apps/server/.env > /dev/null <<'EOF'
DATABASE_URL=file:/var/lib/vidarr/config/vidarr.db
WEB_DIST_PATH=/opt/vidarr/apps/web/dist
PORT=3434
EOF
```
Add `YTDLP_PATH=`/`FFMPEG_PATH=` here only if they didn't land on `PATH` in step 1.

### 5. Run the migration once

```bash
cd /opt/vidarr/apps/server
sudo -u vidarr npx prisma migrate deploy
```

### 6. systemd unit

`/etc/systemd/system/vidarr.service`:
```ini
[Unit]
Description=vidarr
After=network.target

[Service]
Type=simple
User=vidarr
Group=vidarr
WorkingDirectory=/opt/vidarr/apps/server
EnvironmentFile=/opt/vidarr/apps/server/.env
ExecStart=/usr/bin/node dist/main.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```
Confirm `/usr/bin/node` is actually where Node lives (`which node`) and adjust if not.

### 7. Enable and start

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now vidarr
sudo systemctl status vidarr
```

### 8. Get the API key and check logs

```bash
sudo journalctl -u vidarr -n 50 --no-pager | grep -A2 "Generated a new API key"
sudo journalctl -u vidarr -f   # follow logs live
```
If it fails to start, `systemctl status vidarr` shows the exit reason first.

### 9. Upgrading later

```bash
sudo systemctl stop vidarr
cd /opt/vidarr && sudo -u vidarr git pull && sudo -u vidarr npm install && sudo -u vidarr npm run build
cd apps/server && sudo -u vidarr npx prisma migrate deploy
sudo systemctl start vidarr
```

## Native Windows (service wrapper)

### 1. Build

```powershell
npm install
npm run build
```

### 2. Set up the environment and database

Create `apps\server\.env` (copy from `.env.example`) with:
```
DATABASE_URL=file:C:\vidarr-data\vidarr.db
WEB_DIST_PATH=C:\vidarr\apps\web\dist
PORT=3434
```
Add `YTDLP_PATH=`/`FFMPEG_PATH=` if those tools aren't on `PATH`.

Then run the migration once:
```powershell
cd apps\server
npx prisma migrate deploy
```

### 3. Run it directly (to confirm it works before wrapping as a service)

```powershell
node apps\server\dist\main.js
```
The API key prints to this console on first boot. Open `http://localhost:3434` and
confirm the app loads before moving to step 4.

### 4. Install as a Windows service

Plain Node has no built-in "install as a service" mechanism, so use a wrapper:

- **[NSSM](https://nssm.cc/)** (Non-Sucking Service Manager) — simplest option:
  ```powershell
  nssm install vidarr "C:\Program Files\nodejs\node.exe" "C:\vidarr\apps\server\dist\main.js"
  ```
  Then set the working directory (`C:\vidarr\apps\server`) and environment variables
  in the NSSM GUI (`nssm edit vidarr`), and start it:
  ```powershell
  nssm start vidarr
  ```
- **[WinSW](https://github.com/winsw/winsw)** — an XML-config service wrapper, same idea.
- **Simplest fallback**: a Scheduled Task set to "run at startup," pointing at a
  `.bat` file that sets the env vars and calls `node dist\main.js`. Less robust than a
  real service (no auto-restart on crash) but requires no extra download.

Downloading and running NSSM/WinSW means fetching an executable from a third-party
site — do that yourself rather than having it done for you, and verify the download
against the project's own release page before running it.

## Security notes (apply to every deployment path)

- Every `/api/v1/*` route requires the API key — there is no unauthenticated access.
- **Don't expose vidarr directly to the internet.** Like Sonarr/Radarr/Lidarr, it's
  designed to be reached over your own network, a VPN, or Tailscale — not
  port-forwarded. It stores plaintext credentials for every indexer, download client,
  and library connector you configure, and has no rate limiting or intrusion
  detection of its own.
- If you do put it behind a reverse proxy, terminate TLS there. vidarr doesn't trust
  `X-Forwarded-*` headers for anything — it only checks the API key header — so
  there's nothing proxy-related to misconfigure into an auth bypass (the class of
  issue Sonarr's own
  [CVE-2026-30975](https://github.com/Sonarr/Sonarr/security/advisories/GHSA-h5qx-5hjf-7c9r)
  was).

See [`README.md`](../README.md) for feature documentation and
[`docs/plan.md`](plan.md) for build history and design rationale.

## YouTube account cookies

In **Settings → General → YouTube account cookies**, upload a Netscape-format `.txt` cookie
file (maximum 256 KB). Sign into an account that can watch the requested video, then export its
YouTube cookies following [yt-dlp's YouTube cookie guidance](https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies).
For a durable exported session, follow that guide's separate private/incognito-session procedure.
Desktop browser login alone does not authenticate the Docker container.

The masked **Cookies configured** indicator confirms that a file was saved, not that YouTube
has accepted the session. Retry the desired video in Queue/artist acquisition after uploading.
If the account cannot view a private video, ask its owner for access or choose another source.
Expired or rotated cookies must be replaced. Uploading a new file replaces the old session;
**Remove cookies** disables authentication for future requests while active requests finish.

Vidarr stores `youtube-cookies.txt` beside the SQLite database (`/config/youtube-cookies.txt`
in Docker) with owner-only permissions on Linux. This persists across container updates and
needs no database migration. Only `youtube.com` and its subdomain cookies are retained; unrelated
browser sessions are discarded. Treat this file and configuration backups as account credentials.
Do not commit them or share them in bug reports. Neither the status API nor the UI returns the
saved cookie contents. Each YouTube yt-dlp process gets a temporary copy that is removed on exit;
Vimeo and other direct providers continue without YouTube authentication.

Authenticated API endpoints: `GET /api/v1/config/youtube-cookies` returns `{ configured }`,
`PUT` accepts `{ cookies: "<Netscape file contents>" }`, and `DELETE` removes the saved file.
All three use the same API-key/session authentication as other settings endpoints.
