# Shared media backend alignment

Date: 2026-10-17  
Baseline: main `9ea7c636560b5792095a9586568aa8f21bf51611`  
Scope: audit, shared model/boundaries, migration plan and behavior-preserving foundation refactor.

The user authorized these four steps after approving the
[live design](requests/2026-10-17-concerts-and-live-performances.md). This authorizes the
foundation refactor; it does not authorize live discovery/acquisition, production migration,
deployment or publication. Music-video product behavior remains the baseline for verification.

## 1. Audit: what is shared and what is coupled

| Area and current source | Finding | Alignment consequence |
| --- | --- | --- |
| `prisma/schema.prisma`: MusicVideo, MusicVideoFile | Artist/title uniqueness identifies a catalog video; MusicVideoFile.musicVideoId is unique. Catalog metadata, qualification totals and deletion intent sit on MusicVideo. | Do not use this row as both a live rendition and all its recording versions/files. Keep catalog identity separate from shared recording/asset ownership. |
| AcquisitionSource, DownloadQueueItem, History | These require a MusicVideo FK; active-queue uniqueness reserves one acquisition per video. | Preserve current reservations. Future acquisitions must target a particular recording/version without duplicating the queue infrastructure. |
| `pipeline/grab.ts`, `downloadDispatcher.ts` | Direct and indexer transfers already converge on one processing runner, capacity limits and import path. Unknown submissions retain reservations. | Reuse this execution/recovery path; do not create a LiveDownloadQueue or parallel dispatcher. Decouple persistence targets only after migration. |
| `pipeline/validationPolicy.ts`, `directSourcePriority.ts` | Accepted/confirmed authoritative music-video sources can receive canonical validation; direct-source preference ranks authority. | Keep catalog policy explicit. Live source trust cannot inherit canonical music-video exemptions or fixed direct-source preference. |
| `pipeline/validateVideoFile.ts`, `validationWorker.ts` | File/motion inspection and its single worker are media mechanics despite the music-video function name. Probe errors, unknown durations and motion limitations are established behavior. | Extract one shared implementation and worker; retain compatibility exports, errors, defaults and limits. Do not represent this probe as complete audio/corruption validation. |
| `pipeline/videoStatus.ts`, artist/queue APIs, deletion | Ownership facts and active download statuses are repeated across UI/search/deletion paths. | Centralize lifecycle facts and active reservations; keep music-video monitoring eligibility in its policy adapter. Preserve SQL atomic claims/indexes. |
| `pipeline/search.ts`, `locateVideoFile.ts`, downloadclient provider types | Indexer failures are logged while successful results return; folder import chooses one largest video. Download-client interface has no selective-file capability. | Live search needs structured partial/error outcomes and budgets; packs need enumeration and verified selection capabilities. Do not silently reuse largest-file selection for live packs. |
| `pipeline/import.ts`, `importBundle.ts` | Bundle staging/rollback is reusable. Registration upserts one file; old changed-path video is cleaned after DB commit, before later server confirmation. | Preserve current music-video behavior in this refactor. Future live upgrades must retain versions until confirmed delivery and optional cleanup; do not inherit automatic one-file replacement. |
| `libraryVideoSync.ts`, `pendingImportReconciliation.ts` | Canonical artist/title/year/runtime matching maps server rows to one MusicVideo; delivery also requires mapped root and exact relative path. Large confirmation queries are bounded. | Preserve delivery safeguards/batching. Event identity/recording coverage must be separate match policies, not artist/title fallback extended to live. |
| `providers/library/*`, root/connector models | Current Jellyfin reads MusicVideo items; both connectors use one selected videoLibraryId and artist-root delivery mappings. | Share provider transports, but capability-check live destinations/item types and per-kind mapping before enabling them. No inferred movie/chapter support. |
| `playlistGenerator.ts`, `playlistPush.ts`, PlaylistItem | Membership is MusicVideo-based; push sends whole server item IDs. | Introduce typed recording/segment references later. Preserve order, last-good publication and explicit unsupported-segment fallback. |
| `qualifiedPlayback.ts`, `lastfmScrobbling.ts` | Shared continuous-watch calculation already exists. Current qualification rows are connector/session/video-bound; inactive diagnostics expire after 30 days. Last.fm has separate eligibility and delivery state. | Share observation mechanics now. Live indefinite resume needs a distinct durable user/performance viewing layer, not longer retention on disposable diagnostics. Do not change Last.fm semantics. |
| `deleteVideo.ts`, DeletedVideoRecord | Delayed exact-target deletion protects active downloads/playing items; deleting MusicVideo cascades file/history/playlist/session references. | Reuse mechanical safeguards. Future recording deletion must retain performance history; event removal and exclusion hierarchy need explicit boundaries. |

## 2. Shared model and module boundaries

Use one backend, one worker/dispatcher/import/delivery infrastructure and shared provider
transports. Separate catalog policies from media mechanics; no copied live-specific queue,
validation worker, import pipeline or connector implementation.

Proposed logical model (a migration design, not newly created tables):

| Entity | Purpose and cardinality |
| --- | --- |
| Artist | Existing stable MusicBrainz identity, shared across catalogs. |
| Music-video catalog entry | Existing MusicVideo identity/API ID, IMVDb authority, monitoring and official-video rules. Links to one or more recordings; legacy preferred recording remains representable. |
| Performance / song occurrence | Live event/set and ordered particular song renditions, including participant roles, provenance and unknown date/place precision. MusicBrainz/setlist.fm references are optional. |
| Recording | A particular capture/edit, independent of catalog identity. Links to a music-video entry or live performance(s); alternate cameras/edits remain distinct. |
| Recording part | Ordered part of a recording; a recording may be one file or multipart. Parts and alternate recordings must not be collapsed by title. |
| Media asset and file location | Asset identity plus physical copies/root paths. Preserve existing MusicVideoFile IDs as compatibility references during transition. Same-content proof is separate from provider-item identity. |
| Recording coverage / segment | Links a recording/part time interval to a particular song occurrence or grouped performance, with verification state. Unknown boundaries are not invented. Supports multi-event compilations. |
| Source / acquisition intent | Retained provider provenance, acceptance/evidence and selected recording/version target. Existing queue remains the execution engine with a compatibility musicVideoId bridge. |
| Server item / match | Connector/library/external item and media-source/version identities, native counts, availability and confirmed asset/recording match. A server match is not performance identity. |
| Viewing and observations | Durable server-user/performance viewing, resume/earned progress and once-only qualification; separate short-lived observation records. No cross-server account linking in the first live release. |
| Playlist reference | Typed music-video/recording/ordered-parts/song-segment choice, preserving legacy PlaylistItem IDs/order and explicit destination capability checks. |
| Deletion/exclusion intent | Exact recording/file/server targets and separately scoped rendition/artist-set exclusions; recording deletion does not cascade performance history. |

Final Prisma field names and table layout must be reviewed against cardinalities and populated
data before migration. Avoid an untyped targetId/EAV store or parallel per-catalog copies of
shared infrastructure. Catalog-specific associations can be separate tables with real FKs;
shared recording, asset, queue and provider services remain single implementations.

### Implemented foundation boundary

- `media/lifecycle.ts`: database-free ownership/acquisition facts and active reservation states.
  Inputs are media availability/confirmation facts, not a MusicVideo Prisma row or artist/title.
- `media/playback.ts`: structural continuous-watch observations independent of library-provider
  DTOs and catalog qualification caps.
- `media/inspection.ts` and `media/validationWorker.ts`: one physical file/motion inspector
  and one process-local worker for every caller. Existing bounded process/thread utilities
  remain shared infrastructure under their legacy pipeline paths.
- `catalog/musicVideoPolicy.ts`: current music-video monitoring eligibility, source authority
  classification/preference and four-minute qualification cap. These policies are not silently
  applied to live recordings.
- Existing `pipeline/*` entry points remain compatibility adapters/re-exports so API imports,
  test injection, queue recovery and integrations keep their contracts.

Persistence-heavy acquisition, import, delivery, playlists and deletion continue to use the
existing shared execution path. Their recording-target migration is planned below; this refactor
does not pretend those paths already support multipart live data. Do not instantiate a live
policy adapter until the live workflows and persistence are separately authorized.

## 3. Migration and cutover plan

### Phase A: behavior-preserving foundation (this change)

No schema/data changes. Extract shared mechanics and explicit music-video policy adapters while
retaining old exports, HTTP contracts, error classes/messages, source defaults, queue reservations,
validation timing, inspection limits and all required workflow outcomes. Run characterization,
failure/recovery tests and the Node 22 production build. Rollback is a source/image rollback;
there is no database compatibility boundary in this phase. No deployment is performed here.

### Phase B: additive recording/asset bridge (requires reviewed schema and migration)

1. Back up the configuration/SQLite DB with a tested recovery procedure. Rehearse on a populated
   private copy; do not move or scan-delete production media during migration.
2. Add shared recording/part/asset/file-location and source/server associations using Prisma
   migrations. Add nullable compatibility references without changing old primary IDs or
   removing existing required fields. Explicitly index provider identities and bounded lookups.
3. Backfill one legacy recording/part for each existing MusicVideo and preserve file/server IDs,
   path, quality, native counts, qualified totals, source provenance, queue state/order, retained
   staged paths, rejection decisions, deletion deadlines and playlist item order. Do not infer
   live event identities from isLiveConcert or reinterpret native counts as observed plays.
4. Map file-less/server-only entries without inventing local assets, and preserve unconfirmed
   server observations separately. Repeated migrations/backfills must not duplicate identities.
5. Run consistency checks and compare old vs new reads in shadow mode without enabling new
   catalog behavior. Validate totals and exact associations, not just row counts.

### Phase C: switch shared services behind old music-video APIs

1. Switch one vertical lifecycle path at a time to shared repositories, retaining adapters for
   existing musicVideoId API routes and source-specific policies. Establish one authoritative
   writer; any temporary compatibility writes occur in the same transaction, not two competing
   queues/services. Close crash/retry windows before changing the next path.
2. Move queue reservation/index authority to the recording/version target with a tested migration
   while preserving legacy guarantees. A live version must not bypass a music-video reservation
   for the same underlying recording. Distinct versions must remain independently acquirable.
3. Verify completed-import detection, staged recovery, target-server confirmation, last-good
   playlist replacement and deletion exact-target preflight through the new repository.
4. Keep old APIs/IDs readable while the web client/integrations transition. Do not delete old
   fields/indexes until backfill and compatibility consumers have been verified and retired.

### Phase D: add live catalog policies on the same services

Only after separate live implementation authorization: add events/occurrences/coverage, bounded
search/monitor rules, provider capabilities, durable viewing and the approved UI workflows.
Route them through the same dispatcher, inspector, import/delivery services, playlist publisher
and deletion machinery. Keep all live trust/coverage/upgrade safeguards from the design.

Do not make musicVideoId nullable and start writing live-only queue rows while old code still
assumes it is present. After new-only data is written, an old binary is not automatically a safe
rollback: require compatibility-mode readers or quiesce/export/reconcile the new data before
restoring a prior snapshot. Document that boundary and test recovery before cutover. Deploy only
Vidarr when separately requested; preserve configuration, media and staging mounts.

## 4. Refactor verification and acceptance

| Requirement | Code/verification | Completion evidence |
| --- | --- | --- |
| Separate media facts from catalog eligibility | Shared lifecycle + music-video adapter; mixed confirmed/unconfirmed inventory, active reservation and failed-history tests. | Passed: mediaCore + videoStatus characterization, including all four active states. |
| Preserve source/validation behavior | Existing validation policy and source-priority tests; catalog policy direct and compatibility exports. | Passed: validationPolicy, directSourcePriority and mediaCore trust tests. |
| One inspector and worker | Both compatibility/new entry points use the same implementation; FFmpeg/probe tests and failure/release serialization tests. | Passed: compatibility identity, worker failure/release, validationLimits and real FFmpeg smoke. |
| Preserve playback and Last.fm | Shared structural watch calculation; existing qualification/restart/duplicates and Last.fm tests. | Passed: qualifiedPlayback, lastfmScrobbling, lastfmAccount and structural observation cases. |
| Preserve API/queue/import/delivery/deletion | Full server suite, including API fixtures and transactional recovery cases. No real user-file deletions or media-server writes as tests. | Passed: all 811 tests in 98 server files, including API, import rollback, deletion and delivery. |
| Preserve schema/publication/runtime boundaries | No Prisma migration, public contract change or deployment; build with supported Node 22 Docker environment. | Passed: Node 22 Docker production build; no schema or migration changes. |

This completes a foundation refactor, not the full recording/asset migration or live feature.
Remaining technical work from the live design stays explicit. UI approval is not an assertion
that server chapter-segment publication or client end-of-playback detection has been verified.

Verification environment: disposable Node 22 test container with no network and no production
configuration/media mounts. The real-inspector smoke used only generated five-second files
in a disposable `vidarr-media-core:check` container: audio-only rejected, static video rejected,
moving video accepted after failure, and legacy/shared inspector exports identical.
The production server and web build succeeded; existing Vite plugin deprecation warnings remain.
The inspector implementation was also compared with the baseline after normalizing only its
module imports and generic function name. No production database, file or service was changed.

Final regression result: **811 tests passed in 98 files** (291.26 seconds), including 15 new
shared-foundation cases. The initial focused run passed 48 tests in five files.
The first production compile exposed widened inferred lifecycle string types; an explicit
shared return contract corrected that type-only issue and the final full image build passed.
Changes remain in the working tree for review; no commit, merge, deployment or public image push
was performed. Recording/asset schema migration and live behavior are planned, not applied.

## Music-video test build (2026-10-17)

At the user's request, rebuilt the current working tree as local image
`vidarr:music-video-test-20261017`. Docker reused verified build layers because application
source was unchanged from the preceding successful Node 22 build and 811-test run.
No public image was pushed.

Started the normal image entry point in a disposable container with networking disabled and
empty tmpfs configuration/media mounts. Verified HTTP health, the built web page and JS/CSS
assets, unauthenticated API rejection, all 44 existing migrations, seeded quality profiles,
and an empty catalog/download queue. Real FFmpeg inspection again rejected generated audio-only
and static files and accepted moving video after failure. The test container was stopped and
automatically removed, including temporary data; the test image remains available locally.

Production remained healthy on `vidarr:9ea7c63` at port 3434. No production configuration,
media, database, container replacement, commit or merge was performed. This verifies an isolated
test build; it does not establish a production-data migration rehearsal or enable live workflows.

## Release authorization (2026-10-17)

After the isolated test build, the user authorized merging and locally deploying the tested
music-video foundation, then starting live/concert implementation. The release uses the verified
`vidarr:music-video-test-20261017` image with the existing mounts/environment, an offline verified
configuration backup and retained rollback container. No public image publication is requested.
Live implementation starts after release verification on a separate branch and is not included
in this music-video deployment. Earlier scope restrictions above describe their original phase.

Release completed: PR #25 merged as `1e2eb2b`; local `vidarr:1e2eb2b` is healthy, with backup
and rollback retained and no public image publication. The subsequently authorized first live
catalog increment is tracked separately in [live implementation](live-implementation.md).
