# Review corrections and simplifications — 2026-11-19

This release implements the ten reproduced findings from the full Vidarr review of
`13b6c96`. It preserves identity validation, review, acquisition eligibility, import,
server delivery confirmation and existing data. No database migration is needed.

| Finding | Implemented outcome | Regression coverage |
| --- | --- | --- |
| Indexer fallback accepts unrelated content | Require exact normalized artist/song identity after known presentation labels; hold ambiguous versions/content in History for manual review before any grab | `indexerIdentity.test.ts` |
| Symlink import escapes root | Shared directory planner resolves the configured root, checks existing ancestors before mkdir, and rechecks the completed destination before placement | `reviewCorrections.test.ts`, existing import/Live tests |
| Artist deletion drops active jobs | Reserve the database writer and reject deletion while queued, downloading, importing or uncertain external submissions exist | `reviewCorrections.test.ts` |
| Same-stem sidecar collision | Preflight every staged target and reserve the video stem across MV/Live owners and media extensions; untracked bundles are retained rather than overwritten | `reviewCorrections.test.ts`, import/sidecar tests |
| Punctuation/diacritic inventory counts | Normalize lightweight artist identity keys with the same JS function as inventory; join those keys before SQL counts, filters, letters and pagination | `reviewCorrections.test.ts`, artist summary tests |
| Stale Live server counts | Refresh a changed native count even when availability is unchanged; never infer counts from playback duration | `reviewCorrections.test.ts`, Live delivery tests |
| Video-only full sync fails | Skip the unselected audio stage; retain selected video scans and Subsonic artist discovery | `reviewCorrections.test.ts` |
| Concurrent first playlist publication | Serialize push, unpublish, rebind and local deletion by playlist; retain/reuse the remote identity and centralize failure bookkeeping | `reviewCorrections.test.ts`, playlist tests |
| Server outage discards credentials | Keep the saved key on network/5xx errors, show an unavailable/retry message, clear only explicit 401 rejection | `ApiKeyAvailability.test.tsx` |
| Base32 magnet tracking fails | Decode a 32-character Base32 SHA-1 to the 40-character hexadecimal job identifier; share parsing with queue reconciliation | `reviewCorrections.test.ts`, qBittorrent tests |

## Shared boundaries

- `media/importDestination.ts` owns physical containment and bundle ownership for both MV and Live imports. Existing staging/rollback, validation and delivery remain separate outcomes. Old upgraded files are physically revalidated before cleanup.
- `catalog/artistSummary.ts` owns the summary query and serialization, leaving the route thin. It reads only lightweight identity keys into JS; database aggregation/paging remains server-side. No normalization cache can become stale after artist edits.
- `catalog/playCounts.ts` expresses the local-known/confirmed-server/unknown policy for detail, playlists and SQL summaries; the old `videoStatus` export remains compatible.
- `playlistPublicationLock.ts` serializes the single application's scheduler/API lifecycle operations. It does not hold a database transaction across network calls. Multi-process writers remain unsupported, as with the existing scheduler/queue architecture.
- Reconciliation indexes canonical candidates by normalized artist once per sync and uses an ID map for winners. Existing confidence, tie order, previous matches and explicit rejections remain unchanged.
- Artist source management and playlist editing live in focused UI components with shared playback controls.

## Bounded queue contracts

The sidebar polls `/api/v1/queue/summary`: at most 50 transfer/processing rows, selected display fields and aggregate waiting/unresolved counts. It never downloads the waiting backlog. The Queue page uses `/api/v1/queue/active?page=N`, with 50 rows by default and a maximum page size of 100. Ordering still puts active work before waiting jobs. Move operations act on the complete server queue, including across page boundaries. Completion clamps an obsolete page. The legacy list endpoint stays compatible.

## Verification and release

`npm run verify` runs server tests, web tests and both production builds. CI runs this under Node 22 before the Docker image publication job can start. Database fixture cleanup is one child-first transaction with duplicate deletes removed. Shared SQLite tests remain sequential to avoid cross-test races.

The stale artist-workflow mock assertion accepts the cancellation signal. The playlist navigation test waits for React Query's asynchronous observer render before asserting focus. See the changelog and deployment record for final verification and rollout evidence.
