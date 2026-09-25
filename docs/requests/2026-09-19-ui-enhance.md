# UI enhance

Requested: 2026-09-19

Implementation completed: 2026-09-25

## Implementation record

The request is implemented across the artist-centered Library and Artist Detail pages, catalog and
inventory APIs, acquisition pipeline, and media-server integrations. The completion pass added the
remaining provider-neutral provenance, IMVDb upsert/removal-review behavior, duration-aware
reconciliation, explicit acquisition phases, unmatched review, selected/global searches, connector
scan progress, and target-connector refresh workflow. A dedicated lightweight artist-video endpoint
serves lazy accordions without loading full detail, artwork, or provenance payloads.

Database changes are additive and shipped in Prisma migration
`20260925120000_complete_ui_enhance`. Existing artist/video monitoring and ignore choices are
preserved; provider omissions and unmonitoring never delete catalog records or media. Imported files
targeting a connector remain in an awaiting-scan state until inventory reconciliation confirms them.

Verification covers migration deployment, production server and web builds, the full server suite,
and focused regressions for explicit acquisition phases, scan-wait search suppression, lightweight
accordion data, reconciliation, connector failure safety, search eligibility, queue idempotence,
YouTube validation, filtering, artwork proxying, and play-count behavior.

## Objective

Transform Vidarr into an artist-centered music-video library manager comparable to Sonarr's
series-and-episode model. Artists are the primary Library entities; official music videos are the
items Vidarr accounts for. IMVDb defines the expected official catalog, Plex/Jellyfin scans identify
what the user already has, and monitoring determines what Vidarr may search for and acquire.

VEVO, YouTube, Usenet, and other connectors are acquisition sources, not catalog authorities.

## Core domain requirements

### Artists

- Maintain one canonical, deduplicated artist record with source provenance.
- Form the artist catalog from selected music libraries, artists credited in selected music-video
  libraries, manual additions, accepted recommendations, and IMVDb matches.
- Store display/sort/normalized names, IMVDb identity, official artist image, genre, monitoring
  state, summary counts, aggregate play count, and refresh/reconciliation timestamps.
- All newly discovered or imported artists default to **unmonitored**.
- Monitoring or unmonitoring must never delete catalog records, files, history, or media-server data.

### Official music videos

- IMVDb is the primary authority for the known official-video catalog and expected video count.
- Store title, normalized title, IMVDb identity, date/year, director, duration, official artwork,
  source links, individual monitoring state, ignore state, availability, acquisition state, play
  count, and match information.
- Refreshes must upsert metadata without losing monitoring/ignore decisions.
- Items removed from a provider response are flagged for review rather than immediately deleted.
- Artist and individual-video monitoring are independent. Unmonitoring an artist suspends automatic
  work but preserves its videos' individual monitoring selections.

### Media-server inventory

- Inventory every item in selected Plex/Jellyfin music-video libraries.
- Retain connector, provider item/library IDs, title, artist, year, duration, path, play count,
  thumbnail availability, last sync, canonical matches, confidence, and unmatched state.
- Keep media-server availability distinct from Vidarr local-file ownership.
- Reconcile using provider/IMVDb IDs, normalized artist/title, year, duration, file metadata, and
  sidecars. Classify results as confident, probable/review, ambiguous, or unmatched.
- A transient or partial connector failure must not remove existing inventory.

## Main Library page

The Library is an artist list, not a flat video-thumbnail wall.

### Navigation and filtering

- Sort artists by normalized sort name.
- Provide `#` and `A`-`Z` quick shortcuts; disable empty letters and identify the active letter.
- Provide artist-name search, genre dropdown, monitoring-state filter, minimum known official-video
  count, and minimum aggregate play-count filter.
- Also support useful completeness filters: has missing videos, complete, unmatched inventory, and
  active downloads.
- Filters combine with AND semantics, are case-insensitive where applicable, show result count, and
  should persist in the URL. Provide a clear-all action.

### Artist rows

Each row shows:

- One official artist/band image or placeholder (not all video thumbnails).
- Artist name and genre.
- Artist monitored/unmonitored control.
- Known, available, missing, monitored, and downloading video counts.
- Aggregate play count and any error/attention indicator.
- Accordion control and link to the full artist page.

### Accordion

Expanding an artist lazily loads a compact official-video list. Each video shows title, date/year,
basic metadata such as director/duration, individual monitoring control, availability/acquisition
status, play count, and a detail link. The accordion does not need video thumbnails. It must be
keyboard accessible, preserve filters, and explain unmatched artists or empty IMVDb catalogs.

### Bulk actions

- Select individual results or all visible/filtered artists.
- Bulk set selected artists monitored or unmonitored.
- Show the affected count and report success/partial failure.
- Monitoring alone must not automatically start acquisition unless separately configured.

## Artist detail page

The header shows artist artwork, name, genre, monitoring state, IMVDb status, play count, summary
counts, metadata refresh, reconciliation, and search-missing actions.

This page shows every official video's thumbnail/screenshot and:

- Title, date/year, director, and duration.
- Individual monitoring and ignore state.
- Local ownership and media-server availability as separate facts.
- Play count, matching confidence, and acquisition progress.
- Actions to monitor/unmonitor, search, ignore/unignore, and review uncertain matches.

Defined video states include available on server, available locally, available in both, missing,
searching, queued, downloading, importing, awaiting server scan, failed, unmatched, ambiguous, and
ignored. Availability, acquisition progress, monitoring, and match quality must not be collapsed
into one misleading boolean.

Artist-level actions include monitor/unmonitor artist, monitor/unmonitor all videos, monitor missing
videos, search missing monitored videos, refresh IMVDb, reconcile inventory, and review unmatched
items.

## Missing-video search and acquisition

A video is eligible only when it is an official catalog item, missing, individually monitored,
owned by a monitored artist, not ignored, and has no active acquisition. Support search for one
video, one artist, selected artists, or all eligible videos; show the affected count and prevent
duplicate queue entries.

Preferred source order:

1. Authoritative IMVDb-linked source.
2. Verified official artist or VEVO upload.
3. Other confidently matched YouTube/Vimeo upload.
4. Configured Usenet/Torznab/Newznab source and download client.
5. Manual review when confidence is insufficient.

The design remains provider-neutral even though roughly 95% of acquisitions are expected from
VEVO or YouTube.

## YouTube/VEVO validation

Vidarr must avoid acquiring a song playing over static album art or other non-official content.

Positive signals include an IMVDb source URL, verified official/VEVO uploader, artist/title match,
plausible duration, authoritative description/label metadata, and visual motion consistent with a
produced video.

Reject or require review for static artwork, Topic-generated audio, “Provided to YouTube” tracks,
lyric videos, visualizers, karaoke, instrumentals, fan videos, reactions, covers, live/concert
footage, shorts, teasers, trailers, behind-the-scenes clips, duration mismatches, or unrelated
artists. Accept these automatically only when IMVDb explicitly identifies the exact item as the
official video.

Use provider metadata first and bounded sampled-frame/motion analysis only when needed. Do not
download an entire file solely for validation. Every candidate is accepted, rejected with a reason,
or held for manual review; low-confidence candidates are never grabbed automatically.

## Artwork, play counts, and genre

- Use one official image on Library artist rows; show video images on artist detail pages.
- Proxy authenticated media-server artwork through Vidarr so credentials never reach browser URLs.
- Lazy-load bounded images and degrade to placeholders without breaking the page.
- Aggregate artist play count from matched videos. For duplicate copies of one canonical video,
  default to the highest provider play count instead of summing duplicates.
- Keep unknown play count distinct from zero.
- Normalize genres, include All and Unknown options, and match a multi-genre artist on any assigned
  genre.

## API and performance requirements

- Provide a paginated, deterministic artist-summary query accepting all Library filters.
- Provide lightweight lazy accordion data separately from full artist detail/artwork.
- Provide artist detail with official catalog, availability, acquisitions, monitoring, and artwork.
- Provide single and bulk artist/video monitoring mutations with partial-failure results.
- Provide IMVDb refresh, connector inventory scan, reconciliation, and unmatched-review APIs.
- Provide idempotent single/artist/bulk/all missing-video search APIs.
- Support thousands of artists and tens of thousands of videos without loading all details/images.
- Use server-side filtering/aggregation, pagination or virtualization, lazy loading, indexed lookup,
  batched writes, and no per-row N+1 query behavior.
- Long scans expose a running/progress state.

## Accessibility and error states

- Label filters, expose accordion semantics, make all controls keyboard accessible, and never rely
  on color alone for status.
- Monitoring toggles identify both target and current state. Preserve predictable focus after
  filtering/bulk actions and announce results to assistive technology.
- Provide actionable states for no results, no IMVDb match/catalog, failed refresh/scan, no
  reconciled inventory, missing artwork, unavailable provider, low-confidence candidates, and
  partial bulk failure.

## Data safety and compatibility

- All database changes use Prisma migrations and preserve current users, artists, videos, files,
  connectors, playlists, and history.
- Preserve existing monitoring values; only newly introduced artists default to unmonitored.
- Never treat remote inventory as a Vidarr-owned local file.
- Never delete media or catalog data because of unmonitoring, provider refresh, or transient sync
  failure. Keep credentials server-side.
- Update CHANGELOG and relevant long-form documentation with implementation commits.

## Required automated coverage

Cover canonical deduplication/provenance, unmonitored defaults, independent artist/video monitoring,
IMVDb refresh preservation, safe connector failure, all reconciliation classifications, combined
filters, alphabet/sort behavior, bulk partial failure, search eligibility and queue idempotence,
YouTube positive/negative classification and static-art rejection, artwork proxy authentication,
play-count aggregation, pagination/sorting, schema migration, and production server/web builds.

## Acceptance criteria

1. Library is artist-centered with `#`/`A`-`Z` shortcuts.
2. Search and combined filters cover name, genre, monitoring, known-video count, and play count.
3. Filtered artists can be bulk monitored/unmonitored; new artists default unmonitored.
4. Each artist row has one artist image, summary/status counts, and an accordion.
5. Accordion videos show compact metadata, status, and individual monitoring controls.
6. Artist detail shows all official video screenshots/thumbnails and explicit statuses.
7. IMVDb defines the expected official catalog and count.
8. Plex/Jellyfin inventory accounts for owned videos without implying local ownership.
9. Monitored missing videos can be searched at single, artist, selected, and global scopes.
10. Acquisition supports YouTube/VEVO, Usenet, and other configured providers.
11. Static-art/audio-only, lyric, visualizer, fan, and other incorrect uploads are rejected or held
    for review; uncertain results never become silently confirmed.
12. Large libraries remain performant and existing data/media remain safe.
13. Migrations, documentation, automated tests, and production builds pass.

## Out of scope

- Deleting media from Plex, Jellyfin, or disk.
- Treating every VEVO/YouTube channel item as official.
- Replacing IMVDb with channel enumeration.
- Monitoring every imported artist automatically.
- Starting downloads merely because monitoring was enabled.
- Showing all video thumbnails on the main Library page.
- Conflating server availability with local ownership.
