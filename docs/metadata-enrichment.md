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

MusicBrainz is the user-selected primary external source for artist, album, album year and label.
Existing metadata remains protected; IMVDb supplies verified video-specific director credits.
Existing valid musicvideo NFO fields, a unique local album with matching artist credit, confirmed
Vidarr inventory/catalog links, exact accepted IMVDb video IDs and embedded MusicBrainz
recording/release identities supply evidence. MusicBrainz release lookup checks artist credits
and actual recording track membership. Search is bounded to two five-recording queries, two exact-title
recordings and three releases each, using the shared 1.1-second limiter. The second query is allowed
only when a trailing mix/edit/live/version suffix prevents a match; its results remain unverified
version suggestions. Existing filename/title parsing supplies search hints when stored artists are
uploaders. Unconfirmed observations can receive up to three MusicBrainz artist suggestions; only a
unique exact name/alias candidate supplies album-search hints, and all dependent external facts stay
blocked until Artist Review. Artist suggestions are cached in-process for one day, capped at 1,000
names; provider failures are never cached as empty results. No artist/catalog identity is created,
confirmed or downgraded by this enrichment path. Name/title-only evidence
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

## Production native activation (2026-11-05)

The fresh plugin rebuild passes 64 core tests and reproduces the exact verified 0.1.4.0 DLL hash
above. Production server identity `0f6ba0becaee4e95a85e449a47153313` remains Jellyfin 12.3.0.
Its administrator restart activates 0.1.4; the metadata capability reports enabled timing and the
same two selected music-video libraries. Both were rebuilt/checked: 4,274 processed, 4,271 valid
owned tracks unchanged, with only the existing missing-duration files skipped (Analog Blumpkin,
Tesla by They Might Be Giants, and You May Be Right by Yo La Tengo). No media repair is implied.
All 4,271 production video sizes and UTC modification times match the fresh predeployment snapshot.
All 12 saved playlists and sync records, library options/paths, connector/settings fingerprints,
catalog IDs and user subtitle configuration pass preservation checks. Volatile library refresh
status is excluded from configuration comparison. A fresh consistent database backup is retained
inside the configuration volume under `operator-recovery`; secrets remain inside that volume.

A separate Docker test Jellyfin 12.1.0 named vidartest had claimed the production IP/port while the
native production server remained reachable on loopback. Stopping that test container restored the
configured address to the expected production identity. Its unless-stopped policy, configuration
volume and media mounts are retained; restarting it on the same port would recreate the conflict.
The isolated plugin lab is stopped after verification. Vidarr's full image activation is recorded
separately from this completed native rollout and from library-wide enrichment completion.

## Full Vidarr rollout (2026-11-05)

The complete no-cache build refreshes the application and runtime dependencies. The final image is
`vidarr-metadata-enrichment-20261105:final` (manifest
`9622cb00c2b250fe6e3562dcd9839f761efbde0a8d5b20b1d3807b6648482198`), including the corrected
MusicBrainz filename/title and unconfirmed-artist suggestion path. Node 22 server/web builds,
19 focused server/provider checks and the guarded metadata-review UI check pass for that correction;
the initial inventory/migration/playback checks remain applicable. The served bundle is
`/assets/index-BxcgXhEz.js`; the authenticated API and automatic scan hook are verified live.
Runtime checks confirm Node 22.23.2, yt-dlp 2026.10.26, static FFmpeg 7.0.2 and packaged FFmpeg 5.1.9.

Vidarr is healthy after replacement with all four mount identities and environment values retained.
All 12 saved playlists, ordered membership/sync records, original catalog IDs, settings/connector
fingerprints and Jellyfin configuration pass preservation checks. Available Vidarr video IDs match
all 4,271 selected-library Jellyfin IDs exactly. Production playback negotiation for Morrissey /
Tomorrow verifies the owned track and automatic burn-in without starting playback.

Batch #1 is retained as a cancelled audit after the search correction, with no metadata fields
applied. Fresh batch #2 is running over the full inventory, high-water ID 11502. MusicBrainz is the
user-selected primary external metadata source. A live read-only search returns the English
singer-songwriter Morrissey, but his existing Vidarr observations remain unconfirmed: normal
Artist Review is required before dependent suggestions can be applied. No identity is silently
promoted. During the initial batch checkpoint, MusicBrainz HTTP 503 and an IMVDb HTTP 404 are
recorded as failed checks for retry, with existing facts retained. The batch remains in progress;
unknown/review/failed facts are not a claim of complete metadata enrichment.

The predeployment database backup and configuration baseline remain private in the configuration
volume. Only video IDs/paths were exported for filesystem preservation checks; all 4,271 original
sizes and UTC modification times match. Prior application containers, including the intermediate
release, remain stopped for rollback. The conflicting Docker test Jellyfin remains stopped so the
production address continues to resolve to the native server.
