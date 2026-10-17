# Live implementation: first catalog increment

Date: 2026-10-17. Branch: `codex/live-catalog-foundation`.

The user authorized merging/deploying the tested music-video foundation and then starting live
concert implementation. The foundation was merged in PR #25, main `1e2eb2b`, and deployed locally
as `vidarr:1e2eb2b`. HTTP and Docker health passed; SABnzbd remained running. Configuration backup
`vidarr-backup-20261017-media-foundations-1e2eb2b` and rollback container
`vidarr-rollback-20261017-media-foundations-1e2eb2b` are retained. Existing configuration, media and
staging mounts were preserved. The offline backup verified 3,051 artists, 4,281 videos, 618 queue
rows, 48,023 review candidates, 676 files and 58 staged files. Background downloads may change
these totals after startup. No public image was published.

## Implemented scope

This is the first usable catalog slice of the [approved design](requests/2026-10-17-concerts-and-live-performances.md),
not the completed live feature. Live code and its migration are not deployed to production.

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

The music-video release remains healthy on `vidarr:1e2eb2b`. This live increment is a local branch
checkpoint, not merged or deployed, and its migration has never run against production data.

## Unified local release authorization (2026-10-17)

After the first increment passed its checks, the user authorized merging and deploying one
unified music-video/live app locally. This supersedes the earlier not-yet-deployed checkpoint
notes above. The release includes the live catalog increment only; provider discovery, matching,
shared acquisition-target cutover and playback remain the subsequent work listed in the matrix.
Use the tested image, rehearse the migration against a private backup copy before production,
and deploy only Vidarr with an offline verified backup and retained rollback. Skip public
image CI/publication. Never restore an old snapshot to discard live records created after release.
