# Jellyfin and MTV metadata enrichment

Every successful nonempty Jellyfin music-video inventory scan queues enrichment for its selected
video library. Generation of playlists uses that same inventory scan, so it also queues work.
The scan does not wait for provider enrichment or imply that every field is known. Plex, audio,
movies, episodes and unselected libraries are excluded. Standard Jellyfin metadata scans outside
Vidarr do not call Vidarr; the next Vidarr connector scan queues their resulting inventory.

Settings → MTV Metadata shows the latest 20 batches, current inventory start, progress, paged
evidence and pause/resume/retry controls. Enrich current inventory queues work against the last
successful inventory; use the normal connector scan first to discover newly added files.
Only one batch owns a connector. A scan during running/paused work retains one follow-up batch,
coalescing subsequent scans. Pausing retains both work and proposals; it does not undo applied
metadata. Cancel a paused/queued batch to release its scope while retaining its audit.

## Verification and review

The native MTV plugin 0.1.4 or newer must be enabled for the selected library, with nonzero overlay
timing and an administrator-authorized Jellyfin credential. It reports a fingerprint over item
identity, media path, duration, fields, provider IDs, locks and NFO hash. No partial Jellyfin item
DTO is posted to the general Items endpoint, which would risk clearing unrelated fields.

Existing valid musicvideo NFO fields, a unique local album with matching artist credit, confirmed
Vidarr inventory/catalog links, exact accepted IMVDb video IDs and embedded MusicBrainz
recording/release identities supply evidence. MusicBrainz release lookup checks artist credits
and actual recording track membership. Search is bounded to five recordings, two exact-title
recordings and three releases each, using the shared 1.1-second limiter. Name/title-only evidence
and editions/remixes require review. Existing confirmed unchanged video evidence may be reused
for seven days; unresolved identities are checked again so new identity decisions can take effect.

Missing unlocked fields are filled only when verified evidence agrees. Album year and label stay
with the identified album, and video/upload years never supply album year. Populated identity,
titles, labels and credits remain intact unless an operator selects evidence/fields and explicitly
allows corrections. Artist Review and Video Review retain their canonical identity/content rules;
enrichment never admits an audio recording, uploader or uncertain video into the catalog.

Expanded rows show current/proposed values, source/entity links and observation time. Select the
coherent release package and individual fields, then Apply selected facts. Locked fields are
refused even after review. Ambiguous or absent facts are allowed to remain unresolved; a complete
five-line MTV block cannot be guaranteed when sources do not establish every fact.

## Persistence and recovery

Additive Prisma tables store scoped batch IDs, inventory high-water/cursor, proposals, field
evidence, counters and outcomes. The existing single Vidarr scheduler processes three items per
15-second pass. In-process exclusion prevents overlapping worker/review writes; this is not a
distributed worker queue for multiple Vidarr instances sharing one database.

The exact automatic request and UUID are saved before publication. Native journals retain the
request/provenance, before snapshot, fingerprint and planned/NFO-saved/metadata-saved/complete
stage. Repeating a saved request resumes the recorded stage and verifies read-back plus the owned
registered ASS track. Reviewed requests also retain their UUID and selection until verification.
Provider failures remain failed items, rather than empty results. Retry failed keeps saved
proposals; completed rows are skipped when a retry rewinds the cursor.

Writes validate actual typed MusicVideo/library/path membership on the server. Malformed/oversized
or entity-bearing NFOs are refused. Existing NFOs receive byte-preserving backups; XML edits retain
unrelated fields, technical details and credits, using a same-directory atomic replacement and
hash checks. Explicit `<albumyear>` is separate from `<year>` and is consumed only when the NFO
album matches the video's album. Existing unique-local-album fallback and bundled Kabel remain.
Only the affected owned subtitle is regenerated, with existing ownership/hash/revision checks.
Original video bytes/timestamps, foreign subtitles, stream indices and user defaults are preserved.

An interruption between a native side effect and its journal checkpoint can leave an intentionally
refused fingerprint conflict. Inspect the item's current metadata/NFO; finish or cancel the old
batch, then start a fresh batch to take a new snapshot and regenerate the affected track. No blind
rollback overwrites subsequent user edits. A changed server/library pauses the old scope: cancel
that paused batch and scan the intended target to create a correctly scoped replacement.

## Requirement traceability

| Requirement | Implementation | Verification |
| --- | --- | --- |
| Durable start/pause/resume/retry and scan hook | metadataEnrichment pipeline/API, libraryVideoSync, scheduler job | metadataEnrichment API tests and connector-sync regressions |
| Provenance, ambiguity and conditional fill | provider evidence, automaticFacts, review page | provider HTTP simulations, field safety and UI tests |
| Portable shared metadata/NFO and separate album year | MetadataController, EnrichedNfo, OverlayService.Refresh | native core tests and isolated exact-version lab |
| Authorization, stale edits, owned subtitle and nonmusic exclusions | elevated controller, scoped selection, fingerprints, owned store | isolated native lab and core failure cases |
| Backward-compatible persistence and configuration | additive Prisma migration | populated migration check and deployment snapshots |

## Release verification (2026-11-04)

Node 22 production server/web builds pass. Focused checks cover 11 enrichment API/worker tests,
five provider HTTP tests, 23 connector inventory/identity regressions, a populated migration and
nine UI/regression checks. The exact Jellyfin 12.3.0 / .NET 10 plugin passes 64 core tests. Native
isolated-lab playback checks and 20 enrichment checks verify elevation, scope, conditional
write-back/read-back, explicit album year, original bytes/mtime, other tracks and subtitle defaults.
Plugin package 0.1.4.0 DLL SHA256 is
`9a3fcd3cd9d797777f40c627c8a8bdeac4ac30f9028941a808392a2b87e19391`.
These checks establish build/lab behavior; production activation and library-wide completion are
reported separately. No physical Roku viewing of the new enrichment release is claimed.
