# Deployment

### Local shared artist heading and appearance update — 2026-10-27

The approved local trial now runs `vidarr-live-candidates-20261027:appearance`, manifest
`sha256:8ebf340d52435487f09444dc964c0058b43bff14cd2cf77407b4c70870944fac`.
This rebuilds web assets over the verified trial runtime; server code, schema and production
dependencies are unchanged. Music Videos and Live share their artwork/name heading, catalog
navigation and standard button sizing. Global selectors retain consistent geometry. Borders are
two pixels, Music Videos uses vivid `#FFFF66`, and Live uses a black background with dark panels.

The Node 22 production web build and all 87 UI tests pass, including Live artwork loading and
object-URL cleanup. Only Vidarr was recreated. The active address is unchanged and healthy;
read-only comparison with the offline backup passes catalog/review/recording IDs, queue accounting,
credentials, playlist membership and SQLite integrity. Live search/pagination remains verified.
The page's currently referenced JS/CSS assets contain the new heading and theme, and the
authenticated artist-image endpoint returns an image. Retained older hashed assets are not
evidence of the currently served theme. Visual browser acceptance is still not claimed.

Retain `vidarr-backup-20261027-live-appearance-f5dcd6e` and the stopped, restart-disabled
`vidarr-rollback-20261027-live-appearance-f5dcd6e`. Configuration/media/staging mounts and runtime
environment are preserved. The old temporary operator archive was root-owned; its refresh as
the app user failed, so all five current files were recovered directly from the retained prior
container and restored with verified content hashes. Future archive refreshes should run as root
and check each native-command exit status. No media or other service was changed, and this update
has not been published.

### Local Live candidate trial build — 2026-10-27

Branch `codex/live-discovery-rows` provides music-video-style compact, expandable Live discovery
rows, artist-scoped title search and independent 25-item video/reference pages. Local image
`vidarr-live-candidates-20261027:local` has manifest
`sha256:c7caec244daa475f6db3cf7103325fa7aadbe7127584ca407338569fb980e2c4`.
Both Node 22 production builds pass. Sixteen backend tests pass; the web suite's other 80 tests
pass and the final affected six-test interaction rerun passes, covering all 86 UI tests.
The initial interaction failure selected a transient button-feedback label; the corrected test
uses the stable expansion attributes.

A disposable container with no network or production mounts passes all 47 migrations, SQLite
integrity, health/web startup and media-tool checks. Thirty fixture videos verify 25/5 paging,
ten filtered results, separate reference scope and zero promoted performances or downloads from
reads. Built UI assets include the new candidate controls. Browser automation could not verify
the current browser URL, so visual browser acceptance is not claimed.

After explicit user installation approval, this image is installed locally and healthy at
`http://192.168.0.8:3434`. The earlier automatic-review rejection of service replacement was
resolved by that approval; no public push or image publication was performed for this trial.

The read-only post-install audit confirms original IDs for 3,051 artists, 7,182 music videos,
678 owned files, 68,898 review candidates, 19,566 Live discoveries, 21 Live performances,
420 song occurrences, 7,183 recordings, 7,182 parts and ten playlists. Queue entries are accounted
for; credentials, exact playlist membership and SQLite integrity pass. Live HTTP checks verify
bounded paging, title search, reference scope and new UI assets. Adele has 29 video candidates
and 20 reference leads at verification. Visual browser acceptance remains unverified as above.

All four mounts, environment, runtime user and working directory are unchanged. The configured
and actual listener is explicitly `192.168.0.8:3434`; the previous restart policy is retained.
Retain offline backup `vidarr-backup-20261027-live-candidates-9142378` and stopped rollback
container `vidarr-rollback-20261027-live-candidates-9142378`, whose automatic restart is disabled.
Docker Desktop rewrote that stopped container's binding to loopback with an empty host port;
rollback must recreate the service using the preserved mounts/environment and explicit active
address rather than trust the stopped binding. The five private pending Jellyfin operator files
were restored with matching content hashes. Staging retains its persistent mount (58 files at
backup). No schema change, media move, Jellyfin restart or SABnzbd restart occurred.

### Local genre and playlist usability release — 2026-10-25

Image `vidarr-genres-20261025:final` (manifest
`sha256:dd279f0ac2da232893e3cb7a0e620c5314ac2a8991873077ab5cf065705de5aa`)
is healthy at `http://192.168.0.8:3434`. The
[tracked request](requests/2026-10-25-genres-and-playlist-usability.md) records the matching,
source-attribution, advisory cleanup and playlist UI contract. No schema migration was added.

Verification: 129 relevant backend tests and 41 web tests pass, with 16 affected UI tests rerun
after the final group-link correction. Both Node 22 production builds pass. Browser checks confirm
Live-to-generator navigation, prefilled Electronic rules, three-video generation with explicit
publication, and 73 Electronic artists in complete Library browsing. Protected API checks match
Electronic 73 and Rock 335 to genre statistics.

Only Vidarr was recreated, preserving all four configuration/media/D-drive/staging mounts, exact
environment, non-root user, working directory, explicit `192.168.0.8:3434` binding and restart
policy. SQLite quick/foreign-key checks and original IDs match the offline backup: 3,051 artists,
6,299 MusicVideo rows, 4,224 queue rows, 60,176 review candidates, 677 owned file records, 21 Live
performances, 420 song occurrences, 6,300 recordings, 6,299 parts and 10 playlists (including the
two explicitly named UI-verification playlists). Manual genre rows and selected general/connector/
setlist configuration are unchanged. Staging retains 58 files. No media was moved or removed.

Retain private backup volume `vidarr-backup-20261025-genres-playlists-final-6f84` and stopped
rollback container `vidarr-rollback-20261025-genres-playlists-final-6f84`. That rollback is the
intermediate genre release; the pre-feature image/container is retained as
`vidarr-rollback-20261025-genres-playlists-6f84` with its separate offline backup. Rollback must
reuse current mounts/environment rather than restore old data over newer work. Jellyfin and
SABnzbd were not restarted. Private pending Jellyfin overlay helpers/state were restored into
Vidarr's temporary directory after cutover; overlay activation remains a separate idle-only step.

### Local artist-first Live release — 2026-10-22

Deployed source `4529a3b` with the MTV pause in `2b3be32` on local `main`, using
`vidarr-live-artists-20261022:release` (manifest
`sha256:d157dce1a215becb50c4c4aeaf76af37816ee2b5182465448722ea2913320c79`).
The address remains `http://192.168.0.8:3434`. Enter the setlist.fm key under
**Settings → General → Library**, beside IMVDb, and click Save. The reported Adele history
request failed because no setlist.fm key was configured; the new UI explains that prerequisite.
Saving a key does not itself confirm provider access. Native MTV work is archived and excluded.

Verification under Node 22: both production builds, all 72 web tests across 19 files, and 93
relevant Live/settings/authentication/recovery server tests across seven files passed. Live checks
confirmed nine HTTP routes, protected API access, rejection of artist-less catalog searches,
successful artist-scoped reads, boolean-only setlist credential status, new JS/CSS assets,
SQLite quick/foreign-key checks, and identical general and Live configuration fingerprints.
A separate browser tab confirmed the empty password field in the Library settings panel.

Only Vidarr was recreated; all four configuration/media/D-drive/staging mounts, environment,
explicit `192.168.0.8:3434` binding, non-root user and `unless-stopped` policy were preserved.
SABnzbd stayed running. Offline backup `vidarr-backup-20261022-live-artists` was verified before
cutover. The extended snapshot includes optional Live/playlist tables when present, preserving
compatibility with older schemas; disposable legacy and Live fixture tests verify checksums,
ID coverage and unchanged source databases (`research/youtube-discovery-2026-10-16/test-deploy-backup.py`).

Post-cutover checks retained every original artist (3,051), music video (4,296), owned file record
(677), review candidate (48,049), queue entry (3,156), shared recording/part (4,296 each) and
playlist (six). No Live performance, song occurrence or monitoring rule existed at backup.
Staging retained its existing volume and had 58 files at backup. No schema migration was added.

The previous application is retained as `vidarr-rollback-20261022-live-artists`, using
`vidarr-feedback-20261022:local`. Rollback should recreate only Vidarr from that image with the
current preserved mounts/environment and explicit port binding; inspect the binding rather than
assuming the stopped container's ports. Keep backups private and do not blindly restore over new
work. No media files, Jellyfin/Roku clients, other services or public repositories were changed.

### Current scope — artist-scoped Live browsing; MTV development paused

Live mode retains the shared artist index/list and opens searches only within a selected artist.
Enter the single shared setlist.fm API key under Settings → General → Library beside IMVDb,
then use that panel's Save button. Its input stays empty with a saved placeholder after success;
blank saves retain the key. The credential remains in the existing LiveConfiguration row and
is shared with artist discovery. General settings updates write both settings atomically without
resetting Live policies, destinations or budgets; reads return only `hasSetlistApiKey`. The older
Live configuration API remains compatible, while its UI links to the global credential field.
Saving a replacement resets the provider's authentication pause/retry delay, but actual access is
confirmed only by a subsequent artist-scoped event-history request. No schema migration is needed.
The optional MTV client prototype is now preserved under `future/mtv-overlay`, excluded from
application builds and current deployment. No Jellyfin web or Roku overlay was installed by the
previous Vidarr deployment. Earlier deployment records below describe the prototype's old paths;
ignored local client packages remain at those paths for preservation, not active installation.

### Local action feedback release — 2026-10-22

Integrated the optional native client source in `43f47cc` and the application changes in
`a69ae4d` on local `main`. Deployed `vidarr-feedback-20261022:local`, manifest
`sha256:934ce7b3b14b9ee71a305bd81cc5fbc13662beb52746e26cd65c9935c6724352`,
at `http://192.168.0.8:3434`. This includes shared button engagement/pending/failure feedback,
compact artist video actions and the monitoring selectors' vertical right-hand column.
Native Jellyfin web/Roku installation remains a separate client deployment, as described below.

The initial clean image build hit a dependency download reset, then slow Debian downloads.
The local release therefore reuses the running Full runtime `vidarr-full-20261019:release`
(`sha256:c1bc6ea9a1c3811b045010c7c2f59f6b113003966c1503d9829dc72d454648eb`)
after comparing all 100 non-development dependency entries and finding them unchanged. It cleans
the image's application output directories and copies freshly compiled server, shared types,
Prisma client/schema/migrations and web assets. The canonical Dockerfile remains available for
clean builds. Node 22.23.2, uid 1000, static FFmpeg/ffprobe, Debian sample FFmpeg and yt-dlp remain
available. The added jsdom dependency is for browser tests only. No schema migration was added.

Verification: server/web production compilation, 884 server tests across 112 files, and 67 web
tests across 18 files passed under Node 22. Post-cutover checks passed for nine HTTP routes,
authenticated APIs, rejection of unauthenticated API access, the new JS/CSS assets, SQLite quick
and foreign-key checks, and an identical settings/authentication fingerprint. Reloading the
existing browser session displayed the library successfully.

Only Vidarr was recreated. Its four configuration/media/D-drive/staging mounts, environment,
explicit `192.168.0.8:3434` port binding and `unless-stopped` restart policy were preserved;
SABnzbd stayed running. The verified offline backup `vidarr-backup-20261022-feedback` contains
the database/recovery files and configuration archive. Keep the backup private. Preservation
checks found every original row: 3,051 artists, 4,296 videos, 677 owned file records, 48,049 review
candidates and 3,156 queue entries. Staging had 58 files at backup and retains its existing volume.

The previous container is retained stopped as `vidarr-rollback-20261022-feedback` with the old
Full image. For rollback, recreate only Vidarr from that image using the current preserved
mounts/environment/restart policy and explicitly publish `192.168.0.8:3434:3434`. Verify the
binding before starting: the retained stopped container currently inspects with a loopback,
dynamically assigned binding, so simply renaming and starting it would not preserve the address.
The database backup is for recovery; do not overwrite subsequent work with a blind restore.
No media files, other services or public repositories were changed by deployment.

### Native MTV overlay direction

The undeployed pre-render component and its migration were removed after the user selected a
[native playback overlay](mtv-overlay.md). The local database was checked and has no overlay-job
table; no live schema/data rollback is required. There is no overlay output mount or FFmpeg/font
installation option to configure. Native Roku support needs a modified/updated Roku client;
web support needs its own player integration. Both are supplied as separate source components in
the [archived future component](../future/mtv-overlay/README.md), with pinned client
revisions, compatibility checks, settings, tests and reversible source installation. Build and
deploy each Jellyfin client separately; Vidarr's Docker image does not bundle them. The current
web source base requires Node 24/npm 11 for its own build; Vidarr stays on Node 22. Roku sideloading
requires developer mode and replaces the device's existing development channel. No live Jellyfin
web assets or Roku channels have been changed by developing these components.

Native component verification: 10 standalone tests pass without skipped installer checks; the
pinned Roku development client compiles/packages under Node 22; the pinned web client passes its
full TypeScript check and production minification under Node 24. `Dockerfile.web` separates type
checking from bundling and limits bundler/minifier parallelism for the local 4 GB Docker VM.
Installable development artifacts are retained under `integrations/jellyfin-native/build/` and
are separate from the live Vidarr service. See the component README before replacing web assets
or sideloading Roku; source/build success does not confirm playback on the actual device/server.

### Local Full deployment — 2026-10-19

Deployed the complete current application locally as `vidarr-full-20261019:release`, image ID
`sha256:0617d81b8c62cd615c727e884985c6a9344043ec8e0b6a240418f24860260524`,
from the working tree based on `8062e8c`. This includes server-native play counts, global catalog
selection, playlist creation controls and confirmed library-wide searches. It is the existing
full-featured runtime with FFmpeg/ffprobe and yt-dlp, not a new optional-component installer.
Build-edition packaging remains planned and MTV overlay pre-rendering remains on hold.

Verification under Node 22: 884 server tests (112 files), 58 web tests (17 files), and the production
Docker build passed. Fixed the validation-page test's missing router context without changing
runtime behavior. Post-cutover checks confirmed healthy service at `http://192.168.0.8:3434`, ten
HTTP routes, built assets, protected API access, SQLite quick/foreign-key checks, unchanged
authentication and configuration fingerprints, and working media tools as uid 1000.

Only Vidarr was recreated. Existing configuration, media, D-drive and persistent staging mounts,
port binding, environment and restart policy were retained; SABnzbd was left running. Verified
offline backup `vidarr-backup-20261019-full` retains the SQLite database/recovery sidecars and
configuration archive. Keep this volume private because configuration contains credentials.
Preservation checks found all original 3,051 artists, 4,281 videos, 676 file records, 48,036 review
candidates and 1,041 queue entries. Staging retained its existing mount and 58 files at cutover.
No schema change was introduced by this release and no media was changed by deployment.

The previous container is retained stopped as `vidarr-rollback-20261019-full` (image
`vidarr:170bd6b`). To roll back, stop the current Vidarr, rename it to an unused failed-release
name, rename that rollback container to `vidarr`, then start it with its existing mounts.
The backup is retained for recovery; do not overwrite a live database or restore it blindly
over work performed after cutover. No image/source publication was performed.

### Planned editions: documentation only

Future distribution will initially provide Slim (full functionality except video validation
types 1 and 2, without FFmpeg) and Full (everything). No edition images, tags or installation
commands exist as a result of this plan. Current deployment instructions remain unchanged.
Slim and Full are planned installation presets with separately selectable feature components
over shared application code. The current Full deployment uses the existing complete image;
the component installer is not implemented by deploying it.
See [build editions](requests/2026-10-18-build-editions.md) for compatibility requirements and
the non-validation media-tool dependencies that must be resolved before implementation.

### Qualified-play revision

Migration `20261017010000_qualified_play_counts` adds zero-initialized Vidarr counters and
session observations without changing native server counts. The new 15-second tracking job
uses configured video connectors independently of Last.fm. Startup breaks watching continuity
while preserving earlier qualification. See [qualified playback](qualified-playback.md) for
the half-video/four-minute rule and optional Jellyfin webhook setup. Rebuild/recreate only
Vidarr, preserve its mounts and skip public publication for this local-only revision.

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
