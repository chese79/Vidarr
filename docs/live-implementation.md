# Unified live implementation

Historical catalog release, 2026-10-17. Unified local release: `a2d53ea` (PR #26).
The first catalog increment is deployed locally. The completion implementation below supersedes its original scope; deployment status is recorded separately from implementation.

The user authorized merging/deploying the tested music-video foundation and then starting live
concert implementation. The foundation was merged in PR #25, main `1e2eb2b`, and deployed locally
as `vidarr:1e2eb2b`. HTTP and Docker health passed; SABnzbd remained running. Configuration backup
`vidarr-backup-20261017-media-foundations-1e2eb2b` and rollback container
`vidarr-rollback-20261017-media-foundations-1e2eb2b` are retained. Existing configuration, media and
staging mounts were preserved. The offline backup verified 3,051 artists, 4,281 videos, 618 queue
rows, 48,023 review candidates, 676 files and 58 staged files. Background downloads may change
these totals after startup. No public image was published.


## Completion implementation (2026-10-18)

The unified application now implements the approved live workflow in the same server, web app,
queue, transfer dispatcher, validation worker, importer, connector adapters and playlist publisher
as music videos. Catalog policy remains separate: an official music video is not a live event,
and setlist.fm matching never establishes that a moving-video recording exists.

### Workflow and operating limits

1. Reuse a confirmed MusicBrainz artist. Create an independent event, browse one setlist.fm page,
   or activate a scoped history rule after reviewing estimated video requests and budget days.
   Settings, acoustic/electric style, source origin and recording coverage remain separate.
2. Discover YouTube and configured indexer candidates or supply a reviewed YouTube/Vimeo URL.
   Inspected upload/release dates and suggested chapters are evidence only. Review artist,
   performance date, place and songs; automatic confirmation requires all exact elements without
   conflicts. Review every linked event in a compilation. Audio and static images are excluded.
3. Enqueue the reviewed recording in the existing Queue. Unknown classifications always use all
   checks. Full/multipart and live-song policies default to integrity, motion, registration and
   exact delivery. Optional deep checks are read once when validation begins and frozen for that
   processing attempt, including restart recovery. Basic moving video and identity remain required.
4. Retain original files, import approved pack paths in order and register parts. Failed staging
   remains recoverable; retry retained files instead of resubmitting an external job. Clients do
   not advertise proven selective-pack support, so full pack size/contents approval is mandatory.
5. Confirm each exact delivered path in its intended playback library. Refresh acknowledgement
   is not delivery. Use a separately configured connector entry for each distinct playback video
   library so inventory, playlists and playback share the same binding. Supported adapters use
   Jellyfin Music Videos and Plex Movies libraries. Registration of existing files stays in place;
   server-only registration creates an exact server reference, not a fictitious local path.
6. Verify song boundaries and full renditions explicitly. Preserve repeated occurrences, snippets,
   medley components, user quality assessments and pins. Known-song coverage, complete reference
   setlist and verified uninterrupted full performance remain different facts.
7. Start/resume on a compatible Jellyfin client, or use the Plex client when remote start-offset
   support is unverified. Commands are not proof of playing. Chapters jump to a start and continue;
   they do not claim bounded playback. Ordered parts are played without merging/extracting files.
8. Add whole parts or reviewed song selections to static playlists, review membership, Push, then
   confirm publication. Unsupported bounded segments require an explicit whole-file fallback or
   an existing clip. Mixed item ordering uses stable playlist-item IDs.

History browsing is paged (20 reference events per provider page; local lists default 25, maximum
100). Background metadata processes at most 20 rule turns per pass, one page each, with independent
fair-turn bookkeeping. It allows 10 metadata requests/rule/day and 1,000/provider/day, serialized
at least 1.1 seconds apart; successful responses cache 24 hours. Video search defaults to
50 requests/rule/day and 500 globally. A request is reserved atomically before transmission;
overlapping rules reuse the same event/provider search. One pass requests up to eight YouTube
results and the first bounded page from each enabled indexer. Estimates show a range, exclude
unknown event history and do not promise a completion date. Pause/cancel and per-event exclusions
remain available. Empty search retries use 1/7/30/90 days; failures are separate and authentication
errors pause the affected provider until corrected. Search now still respects budgets.

Unowned, unmonitored, unedited references with no candidates or playback dependencies expire after
90 days without material evidence, configurable. Lightweight journals default to one year.
Unchanged scans do not renew evidence age. Owned media, exclusions, playback observations, earned
watch time, unfinished viewing and event history are retained. General activity cleanup excludes
recording-linked and live-event history.

### Playback, recovery and deletion

Observed song viewing qualifies at half its verified duration or four minutes; verified full
performance viewing qualifies at half or 30 minutes. Pauses, seeks, unobserved gaps and overlapping
devices do not earn duplicate time. Parts share one unfinished viewing for the same server user
and performance. Compilation credit is restricted to the union of verified intervals for each
artist set. Unknown duration/boundaries defer only dependent counters. Qualification is separate
from reaching the end. Start again and Mark finished never invent watch credit. Resume and earned
time do not expire. Native server play counts stay separate; account linking across servers is
not implemented.

Connector failures preserve server ownership. Local absence is confirmed only after the root's
persistent storage identity is successfully verified, preventing an unmounted empty directory
from looking like deleted files. Removed external sources do not remove owned copies. Failure
journals and retained queue records expose retry/review actions. No blind indexer resubmission.

Older recording versions remain by default. Optional redundant-copy cleanup proposes only
verified improvements already confirmed on the playback server; it protects pins, unique or
unknown coverage, playlist references and unfinished viewing, and requires a separate deletion
confirmation. Deletion uses the existing warning/exclusion preferences, five-minute delay,
40-minute failure/playing/paused retry and exact server/path checks. Event, occurrence and viewing
history survive deletion of the last recording. Exclusions apply to an exact recording fingerprint,
a particular rendition or one artist set, never an entire unrelated festival.

Flagged music videos enter explicit classification review. Classification reuses the same
recording, file, original video/count and playlist IDs without moving files or downloading again.
Returning requires explicit official-music-video eligibility; multipart ownership is never silently
flattened into one song video. Independent events can attach a later setlist.fm reference while
keeping local IDs and reviewing metadata differences. Private addresses are local metadata and
are absent from provider search queries and server export metadata.

### Recording bridge and migration

Migration `20261018010000_live_workflows` atomically backfills one typed Recording per existing
MusicVideo and logical ordered parts referencing existing MusicVideoFile rows. File-less entries
have null physical paths and no invented ownership. SQLite compatibility triggers keep the legacy
music-video writer and shared recording facts consistent in the same transaction; there is no
second asynchronous writer. Sources, library observations, queue and history gain shared capture
references while existing IDs, acceptance/confidence, counters, order and staging paths remain.
Probable server matches never become confirmed merely because a bridge exists.

A queue row may retain both its legacy musicVideoId and the matching recordingId as references to
one capture. Live rows use recordingId alone. Target guards and partial unique reservation indexes
cover queued, downloading, importing and uncertain submissions. Playlist rows have exactly one
typed target. AUTOINCREMENT high-water marks and foreign keys are preserved. Duplicate active
legacy reservations stop the transaction for operator reconciliation instead of deleting data.
No migration touches media. Triggers and partial indexes are deliberate SQL beyond Prisma's model;
future table-rebuilding migrations must preserve and retest them.

Rehearsal against a private copy of the retained production backup preserved all original columns
and rows across 34 legacy tables: 3,051 artists, 4,281 music videos, 676 files, 618 queue records and
223 playlist items. All 4,281 music videos received recording references; integrity and foreign-key
checks passed. The rehearsal writes only its disposable copy. The earlier catalog migration's
verification below remains historical evidence for that release.

Rollback after new live data is written requires a compatible forward fix or explicit recovery
review. Do not run an old binary against the migrated database, drop new tables, or restore an old
snapshot that would discard subsequent user work. Keep the offline backup and stopped old container
for recovery analysis. Deploy only Vidarr and preserve all config, media and staging mounts.

### Acceptance traceability

| Approved criteria | Implementation / verification |
| --- | --- |
| 1–3: shared artist, overlapping classifications, event and guest identity | Live API, metadata editor, song styles and credits/occasion tools; catalog/API tests |
| 4–6, 8: recordings/parts, exact evidence, independence and correction | setlist, evidence, catalog, source inspection and reference link; correction/identity/recovery tests |
| 7, 11–12: moving video and validation/import | shared inspector/worker and recording acquisition/local registration; acquisition and FFmpeg smoke checks |
| 9: bounded monitoring, estimates, budgets and retention | discovery/metadata monitoring, request budget transactions and retention; budget/preview/overlap tests |
| 10, 13–14: versions, pins, safe upgrade and unchanged files | verified comparison, fingerprints, ordered import, cleanup and reclassification; recovery/bridge/acquisition tests |
| 15: mixed playlists and capability fallback | shared playlist publisher, typed items and explicit fallback; playlist ordering/publication tests |
| 16–17, 21: observed counters, multipart resume and completion | live playback observations and controls; thresholds, overlapping devices, compilation interval and Mark finished tests |
| 18–20, 22: outages, deletion, reclassification and preserved history | delivery/storage identity, deletion snapshots and compatibility bridge; recovery/deletion/classification tests |
| 23: private address boundaries | local metadata editor/schema; provider queries use artist/date/venue only and export only recording metadata |

Deferred scope remains audio-only support, external setlist submissions, automatic clip extraction,
advanced automatic sound/camera analysis and cross-server account linking. The music-video UI
review is recorded separately in `music-video-ui-review-2026-10-17.md`; recommendations are not
silently included as a redesign.

### Completion verification

The Node 22 server regression run passed 865 tests in 106 files. The final affected-path follow-up passed 37 tests in four files and
also covers exact mapped-path confirmation when Plex supplies a filename title, and refusal to
delete a multi-artist compilation through a narrower artist-set or song action. Production server
and web compilation passed; existing Vite deprecation/chunk-size warnings remain.

Real FFmpeg checks rejected generated audio-only and static-image fixtures and accepted moving
video after failure. In a disposable localhost instance, browser verification created an acoustic
television performance with repeated songs, saved/reviewed an independent recording, validated
and registered generated video in place, confirmed explicit song boundaries and saved live
settings. The registered part correctly remained awaiting server confirmation. No test commands
played or deleted user media, published a server playlist or edited setlist.fm. Real remote
playback commands are covered by provider contract tests; deployed client behavior still depends
on its capabilities. Public image publication remains excluded.

## Historical first catalog increment

## Implemented scope

This is the first usable catalog slice of the [approved design](requests/2026-10-17-concerts-and-live-performances.md),
not the completed live feature. The catalog and additive migration are included in the unified
local release documented below.

- Existing confirmed Library artist identities are reused; no second artist catalog is created.
- Independent performance identity has a stable local ID. Dates retain year/month/day precision or
  remain unknown. Setting and style are separate attributes. Identical titles or incomplete dates
  do not silently merge performances.
- Ordered song occurrences retain separate IDs, including repetitions and encore/medley/snippet
  labels. Entered lists do not establish reference-setlist completeness or recorded coverage.
- `Recording` is a shared capture/edit identity with an optional existing MusicVideo association,
  not a second live-specific download/file implementation. `RecordingPerformance` permits one
  compilation to reference several performances and several recordings to reference one event.
- The first recording API records pending candidates only. URL, origin and coverage are evidence
  or claims, not verified video properties. There is no approval/ownership/acquisition shortcut.
  All performances remain Recording unknown until the future video/identity review path proves
  eligibility. None enter missing-video totals or existing music-video searches.
- Live navigation has Performances and Recordings views, with artist-specific context, filters,
  pagination, detail/song lists, evidence capture and performance metadata correction. Revision
  checks prevent stale corrections from overwriting newer data or replacing song/recording IDs.

`GET /api/v1/live/artists` supplies confirmed artists; `/live/performances` supports list/create,
`/live/performances/:id` supports detail/PATCH, and `/live/recordings` supports list/create. All use
the existing authentication hook. Lists default to 25 and cap at 100. Detail includes at most
25 newest candidates with total counts. Candidate links cap at 100 performances and songs at 500
per create request; this is bounded manual catalog capture, not an external-history fetch policy.
No source URL is fetched or published. Precise private-address metadata is not collected.

## Migration and compatibility

Migration `20261017210000_live_catalog_foundation` adds four tables and indexes with real foreign
keys. It does not rebuild or update legacy tables, backfill fake events, change source categories,
reinterpret counts, move files or alter queue/playlist/staging identity. Existing Live/Concert flags
remain playable labels awaiting the later reviewed reclassification flow.

Artist/performance/recording references restrict implicit deletion. The existing artist DELETE
returns 409 when live performances exist. This increment exposes no performance/recording removal
endpoint and performs no file deletion. The recording-to-MusicVideo link is reserved for the
subsequent reviewed bridge/cutover; it is not populated by guessing from titles or flags.

Rehearse on populated test data and verify FK integrity before production migration. An older
music-video binary can ignore the additive tables, but old artist-deletion code cannot manage new
live dependencies. Retain this branch's compatibility guard when live data exists; do not drop
new tables or restore an old database snapshot to discard user-entered live records.

## Traceability and remaining implementation

| Approved requirement | This increment | Remaining work |
| --- | --- | --- |
| Shared artists; independent classifications | Persistent identity and filtered UI | Participants/guest roles and occasion/festival grouping |
| Independent entries and uncertainty | Partial dates/place, independent state, revision edits | MusicBrainz/setlist.fm provider evidence, exact-match and conflict review |
| Distinct recordings and song occurrences | Shared recording candidates and M:N event links | Parts/assets, verified fingerprints, timestamp coverage and preference/pins |
| Video-only and complete workflow | Candidates cannot assert eligibility, ownership or enqueue | Shared acquisition-target cutover, policies, inspection/import and exact delivery |
| Scale and monitoring | Bounded manual lists/details and artist picker | Date-first provider discovery, search estimates, budgets, fair scheduling/backoff/retention |
| Preserve existing music-video data | Additive migration and existing API regression tests | Populated production-copy bridge rehearsal and atomic reclassification |
| Playback and playlists | Existing behavior unchanged | Verified destination capabilities, typed playlist refs, durable indefinite viewing and counts |
| Safe deletion and privacy | No live media deletion; dependency guard; no private-address field | Scoped exclusions, retained performance history, exact targets and optional cleanup |

The next vertical slice is provider evidence and performance match review, alongside the reviewed
recording/asset bridge. Complete shared-target queue/import/delivery integration before exposing a
live download action. No LiveDownloadQueue, copied dispatcher, copied inspector or copied connector
is introduced. Reuse `media/*` mechanics and explicit catalog policies as designed.

## Verification

Node 22 regression: **828 tests passed in 100 files** (384.47 seconds). The final focused
API/migration rerun passed 17 tests after malformed-URL handling was hardened. Tests include authenticated API flows,
invalid/partial dates, independent repeated occurrences, overlapping classifications, multi-event
recordings, missing-target rollback, stale corrections, bounded results and artist dependency
protection. A populated legacy-schema migration test compares full rows for existing artist,
video/file, native/qualified counts, queued staging/order and playlist references before/after.


The final `vidarr-live-catalog:check` image built both server and web successfully. An isolated
browser smoke used only a synthetic artist and temporary database: signed in, created an acoustic
television performance with a month-precision date and repeated songs, saved a recording candidate,
corrected the date to leap day and reloaded. The persisted identity, order and pending-candidate
labels remained correct. No recording source was fetched. UI verification used a localhost-only
server with the scheduler disabled, no production mounts or credentials. Its test container and
network were removed after verification; a synthetic-data screenshot remains in ignored research.

Prisma migrate-diff reports pre-existing LastFmAccount, RootFolder and VideoReviewCandidate
redefinitions on both the deployed 44-migration baseline and this 45-migration image. There are
no additional differences for the new live tables. This is not a claim of a globally drift-free
legacy schema; unrelated legacy corrections were not folded into this feature. Tests use Node's
experimental SQLite module only for isolated migration rehearsal; application runtime still
uses Prisma. The web build retains Vite plugin deprecation and bundle-size warnings.

At the first branch checkpoint, the music-video release remained on `vidarr:1e2eb2b` and the
live migration had not run against production. The subsequent authorized unified release below
supersedes that checkpoint.

## Unified local release authorization (2026-10-17)

After the first increment passed its checks, the user authorized merging and deploying one
unified music-video/live app locally. This supersedes the earlier not-yet-deployed checkpoint
notes above. The release includes the live catalog increment only; provider discovery, matching,
shared acquisition-target cutover and playback remain the subsequent work listed in the matrix.
Use the tested image, rehearse the migration against a private backup copy before production,
and deploy only Vidarr with an offline verified backup and retained rollback. Skip public
image CI/publication. Never restore an old snapshot to discard live records created after release.

Private production-copy rehearsal passed before deployment: Prisma applied the live migration
to an isolated copy of `vidarr-backup-20261017-media-foundations-1e2eb2b`. Full-row SHA-256
comparisons were unchanged for all 34 legacy tables; foreign-key checks passed and only the
four empty live catalog tables were added. The snapshot contained 3,051 artists, 4,281 music
videos, 676 files, 618 queue rows and 223 playlist items. The source backup was mounted read-only;
no rehearsal changes reached production.


## Unified local deployment outcome

PR #26 merged as `a2d53eaea9d8542f3f545e99031cee9e1ec1af86`. Built both applications from
merged main into local image `vidarr:a2d53ea`; no public image workflow ran for that commit.
Docker Desktop was initially stopped and was started to recover the engine before deployment.
Only the Vidarr container was recreated; its mount/environment equality checks passed.

The stopped-service offline configuration backup verified 3,051 artists, 4,281 music videos,
676 managed files, 618 queue rows, 48,023 review candidates and 58 staged files. Backup volume
`vidarr-backup-20261017-unified-live-a2d53ea` and rollback container
`vidarr-rollback-20261017-unified-live-a2d53ea` are retained. Media and staging mounts were not
modified as part of the source deployment.

After startup, migration `20261017210000_live_catalog_foundation` was confirmed complete.
Authenticated music-video summary and Live performance/recording APIs returned successfully;
web routes and LAN health at `http://192.168.0.8:3434` responded. Counts remained 3,051 artists,
4,281 music videos, 676 files and 618 queue rows. The new Live catalog starts empty, with zero
performances and recordings; existing Live/Concert labels were not silently reclassified.
SABnzbd was healthy. Validation evidence remains 828 tests, the final 17 focused tests, merged
server/web production build, isolated browser persistence checks and the private populated-copy
migration rehearsal. This release enables catalog capture only, not live discovery, acquisition
or media-server playback integration.

Final Docker health is `healthy` for `vidarr:a2d53ea`. Both HTTP and container health passed.
