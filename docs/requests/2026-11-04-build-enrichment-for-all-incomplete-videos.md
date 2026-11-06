# Build enrichment for all incomplete videos

Request date: 2026-11-04. The user reported an incomplete MTV block on Morrissey — Tomorrow,
then requested enrichment for all incomplete videos and explicitly chose to save verified facts
to missing Jellyfin metadata as well as the MTV overlay.

## Objective and scope

Provide a library-wide, restart-safe metadata enrichment batch for typed MusicVideo items in a
selected enabled Jellyfin music-video library. Complete the existing five-line MTV block where
sources establish artist, title, album, album year, record label and directors. Missing data and
ambiguous matches remain explicit; a full block is not promised when facts cannot be established.
Do not create catalog videos, acquire media, change monitoring or classify a video as official/live.

Morrissey — Tomorrow is the regression example. Its current NFO/Jellyfin artist is the uploader
`officialmorrissey`, its title includes the artist prefix, and album/year/label/director are absent.
There is no local Your Arsenal album to supply the missing year. Populated uploader/title fields
require an explicit reviewed correction; empty fields may be filled automatically only with
verified, unambiguous evidence. The original MP4 must remain unchanged.

## Source and field rules

On 2026-11-05 the user explicitly selected MusicBrainz as the primary external metadata source.
Retain existing facts and IMVDb verification for video-specific director credits.

- Preserve original server/NFO values and user edits. A locked item/field is never changed by the
  unattended batch. Detect changes between observation, proposal and application.
- Reuse confirmed Vidarr/Jellyfin/Picard artist IDs and confirmed media-server/catalog links.
  Filename/title/uploader guesses are review hints, not artist confirmation. Reuse Artist Review
  for unresolved identities; never silently promote an uploader or name-only MusicBrainz match.
- Reuse catalog metadata and accepted exact video/source IDs for video-specific title/director
  facts. IMVDb details may enrich an established video identity; title-only version matches need review.
- Use local album metadata or MusicBrainz recording/release evidence for album, year and label.
  Prefer an explicitly identified release; otherwise require unambiguous album/release evidence.
  Multiple editions/regions/labels and recording/remix ambiguities require review. Video year and
  upload/publication dates must never substitute for album year.
- Store per-field values, provider entity IDs/URLs, observations and confidence/review decisions.
  Unknown/absent, ambiguous, failed provider checks and applied fields are distinct states.
- Keep MusicBrainz's shared >=1.1-second request limiter and bounded timeouts. Use configured IMVDb
  access and existing fallbacks; no new credentials are embedded in source or sent to the browser.

## Workflow and interface

Select the Jellyfin library → start enrichment of its incomplete inventory → observe progress,
current item and complete/updated/review/failed counts → inspect paged item/field evidence → review
uncertain identity/version proposals or explicitly correct a populated field → apply → confirm
Jellyfin read-back and refresh that item's owned MTV track. Automatic verified missing-field fills
preserve the same checks/outcomes. Provide pause/resume and retry-failed controls; status reads do
not start work. Reruns are idempotent and include newly added/incomplete items.

Expose the workflow from Settings/Library through an authenticated MTV metadata page. Use compact
expandable rows, 25 per page, server-side status/search filters, readable progress, keyboard-accessible
controls and visible retry/error states. Review must show current and proposed facts with sources;
it must not imply that provider suggestions have already been written.

## Persistence, integration and recovery

- Persist batch scope, cursor/high-water inventory, counters, pause/failure/retry state and item
  proposals/audit state. Add Prisma migrations for new tables; preserve populated databases and
  existing artist/video/playlist IDs. Do not store connector secrets in job snapshots.
- Process bounded pages/items, retain checkpoints across restarts, prevent overlapping work on one
  target and pause if server/library identity changes. Provider failures preserve known facts.
- Write only approved missing fields or explicitly reviewed corrections. Use a guarded Jellyfin
  plugin endpoint so local NFO access and exact item/library/path validation work on Windows/Linux.
  Back up prior NFO/owned metadata, preserve unrelated XML/credits/technical data and write atomically.
- Store album year separately from video year and album name. The MTV plugin must consume explicit
  enriched album-year facts, retaining the existing unique-local-album fallback and bundled Kabel.
- Regenerate only the affected owned ASS track, preserving its ownership/hash checks and revision
  backups. Movie/TV/audio and unselected libraries remain outside all write/generation paths.
- Verify the server's resulting fields and owned track before marking an item applied. Partial
  write/registration failures retain recovery state and retry safely; unrelated edits stop automatic
  overwrite. Preserve original video bytes, sizes, timestamps and subtitle/user preferences.

## Acceptance criteria

1. An operator can start, monitor, pause, resume and retry a selected-library enrichment batch;
   restart does not lose proposals/checkpoints or duplicate applied work.
2. Every incomplete item is accounted for as updated, complete, review-needed, unknown or failed,
   with per-field sources and no invented dates/labels/credits.
3. Unique verified facts fill only missing unlocked fields. Populated/uploader corrections and
   uncertain artist/recording/release/video versions require the established identity/review checks.
4. Approved facts persist in Jellyfin and its NFO where applicable, and the affected MTV track
   displays those facts including a separate album year. Album/video years cannot be confused.
5. Stale/conflicting metadata, malformed NFO, edited owned subtitles, inaccessible files, provider
   outages and interrupted writes preserve data and expose recoverable outcomes.
6. Tests cover populated migration, provenance/matching ambiguity, batch recovery/idempotence,
   authorization, conditional write-back and targeted overlay generation, plus movie/TV controls.
7. Node 22 builds/tests and the exact-version Jellyfin plugin build/lab checks pass. Production
   deployment preserves configuration/media and occurs separately from a claimed batch completion.

## Exclusions

No scraping of arbitrary search-engine snippets into metadata; no audio-to-video catalog promotion;
no automatic uncertain identity/source acceptance; no movie/TV metadata changes; no original media
re-encoding, moving, deletion or reacquisition; no Plex write-back in this Jellyfin/MTV request.
