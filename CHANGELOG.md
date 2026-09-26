# Changelog

All notable user-visible and operational changes to Vidarr are documented here. New work is added
under **Unreleased** in the same commit as the change.

## Unreleased

### Improved — partial playlist retry

- Retry a partially published smart playlist at its next regeneration, even when its Vidarr
  membership has not changed, so newly available server items can complete the remote list.

### Fixed — ambiguous Plex playlist matches

- Leave a Plex playlist item unmatched when multiple videos in the selected library have the
  same exact title, instead of selecting the first result. Existing published playlists remain
  intact when this prevents a complete replacement.

### Fixed — playlist replacement safety

- Preserve a previously published Plex or Jellyfin playlist when any selected item is no longer
  confirmed available or cannot be matched in that library. Record the failed push for retry
  instead of replacing the remote playlist with an incomplete copy.

### Improved — imported video reconciliation

- Check pending imports against their configured playback library every five minutes after a
  refresh. Confirm only a unique exact artist/title match, retain pending state after empty or
  ambiguous or conflicting scans, and honor previously rejected matches.

### Fixed — quality upgrade import safety

- Keep the previous video file until its replacement and import history are committed to the
  database. Cleanup also refuses to delete a prior path outside the configured root folder.

### Added — repeatable playlist shuffle

- Choose artist/title order or a shuffled order when generating static or smart playlists. Smart
  playlist regeneration retains the same shuffle seed, so unchanged membership keeps its order.
  Existing playlists keep artist/title order.

### Improved — smart playlist publishing

- Republish a smart playlist to previously pushed playback libraries when manual or scheduled
  regeneration changes membership. A failed push is recorded for review and retried at the next
  regeneration; unchanged successful lists are not republished.

### Improved — playback-library playlists

- Bind a new static or smart playlist to a selected Plex or Jellyfin video library. The picker,
  generated membership, manual additions, and push destination then use confirmed videos in that
  library. Existing playlists remain unbound, preserving their current membership and behavior.

### Improved — playlist rules

- Filter static and smart playlist generation by director, ownership, file quality, and date
  added alongside the existing year, genre, play-count, artist, and video filters.

### Added — smart playlists

- Save playlist filter rules as smart playlists, regenerate them on demand, or schedule daily or
  weekly regeneration. Existing playlists remain static, and smart playlist items follow their
  rules rather than manual item edits.

### Improved — playlists from media-server videos

- Allow confirmed, available Plex/Jellyfin videos in playlist filter results and the manual picker,
  even when Vidarr has no local copy. Push includes a server-only video only for the connector
  where it is confirmed available.

### Fixed — video-library reconciliation

- Preserve existing media-server video availability when a connector unexpectedly returns an
  empty video scan, and retain video-library provenance for artists already known from audio.

### Improved — MusicBrainz artist review

- Use artist credits from up to two observed MusicBrainz recordings and two observed releases to
  rank otherwise ambiguous artist candidates. The review screen shows the credited evidence;
  matching remains a user confirmation step.

### Added — embedded Picard scanning and bulk identity review

- Allow each library connector to scan an optional read-only audio path for embedded Picard tags,
  including MusicBrainz album-artist IDs and genres. Album artists take precedence over track
  performers, `Various Artists` is excluded, and corrupt files do not abort the complete scan.
- Retain a connector-scoped inventory of only the audio recordings actually observed on disk,
  including embedded MusicBrainz recording, release, release-group, artist, album, track, disc,
  and genre evidence. Vidarr does not mirror an artist's complete MusicBrainz discography.
- Merge embedded identity evidence with the same connector's media-server observations without
  losing server play counts or creating duplicate connector artists.
- Add MusicBrainz match-state filtering, top-candidate previews, inline confirmation, and bulk
  candidate discovery to the artist Library.
- Add backward-compatible `musicPath` and observed-recording migrations. Existing connectors
  continue to sync exactly as before until a path is configured.

### Added — MusicBrainz artist identity and authoritative video catalogs

- Resolve connector-provided MusicBrainz/Picard artist IDs before catalog construction, retain
  match evidence and reviewable candidates, and enrich confirmed artists with canonical identity
  metadata without overwriting an existing genre.
- Treat active IMVDb videos as the authoritative expected catalog. MusicBrainz video recordings
  and previously observed non-IMVDb videos remain visible as supplementary inventory and do not
  inflate completeness or missing-video totals.
- Import direct MusicBrainz video relationships as provider-neutral verified sources. Supplementary
  videos default to unmonitored; inventory-only records are explicitly blocked from acquisition.
- Read MusicBrainz artist IDs exposed by Jellyfin, Plex, and Subsonic connectors and construct the
  catalog before reconciling the selected video library.
- Add an additive Prisma migration for MusicBrainz identity, candidate review state, metadata
  provenance, and catalog authority classification.

### Added — completed artist-centered library workflow

- Complete the artist detail workspace with official artwork, catalog/availability/play summaries,
  IMVDb refresh, inventory reconciliation, artist/video monitoring presets, missing-video search,
  acquisition progress, source provenance, and uncertain-match review controls.
- Add provider-neutral artist and acquisition-source provenance. Authoritative IMVDb YouTube and
  Vimeo links are retained separately from the official catalog and can be acquired directly;
  accepted heuristic YouTube results remain recorded with their confidence and origin.
- Reconcile IMVDb refreshes as upserts: metadata and duration are refreshed without resetting user
  monitoring/ignore choices, while provider-removed videos are retained and flagged for review.
- Add complete, unmatched-inventory, and active-download Library filters; monitored and unmatched
  counts; unknown and multi-genre filtering; selected-artist and global missing-video searches; and
  compact duration/director/progress metadata in the lazy artist accordion.
- Inventory Plex and Jellyfin duration data, expose connector scan progress, materialize newly found
  artists as unmonitored catalog entries, and retain match confidence for artist-page review.
- Associate root folders with an optional target Plex/Jellyfin connector. Successful imports request
  a media-server refresh and remain visibly `awaiting server scan` until a later inventory sync
  confirms them, preventing duplicate automatic searches during that window.
- Add a backward-compatible Prisma migration for provenance, duration, catalog review state,
  refresh/reconciliation timestamps, scan progress, target connectors, and awaiting-scan state.

### Fixed — follow-up acquisition and migration review

- Reconcile legacy duplicate active queue rows before installing the active-download unique index,
  preserving every row and marking older duplicate attempts failed so populated-database upgrades
  cannot be stopped by data created by the old race condition.
- Treat failed download-client submissions as ambiguous instead of certainly rejected: Vidarr keeps
  a visible `submissionUnknown` queue/history record and blocks automatic retries that could submit
  the same remote download twice.
- Require bounded motion validation for heuristic YouTube results from verified and VEVO uploaders;
  uploader verification remains a positive signal but no longer proves that an upload is a produced
  music video rather than static artwork.
- Compare cover markers with the canonical song title so legitimate titles such as “Under Cover of
  Darkness” are not rejected while actual fan-cover suffixes remain blocked.

### Fixed — external code review findings (ownership correctness, validation bypass, race condition, SSRF)

An external review of Phases 2a/2b/3 raised six issues; all six were independently verified against
the actual current code (not taken on faith) before fixing. Every fix ships with regression tests
covering the specific property that was broken, not just a happy-path check.

- **Unconfirmed fuzzy library matches counted as owned.** A `probable`/`ambiguous` reconciliation
  match (Phase 2b) wrote `LibraryVideo.musicVideoId` immediately, and nothing downstream —
  `computeVideoStatus`, the Artist Detail API, the Library summary counts, or backlog search's
  eligibility query — ever checked `matchConfidence`. A wrong fuzzy suggestion could silently mark a
  genuinely missing video as present and suppress it from auto-search indefinitely, with no visible
  sign anything was wrong. Ownership and search-eligibility now both require `matchConfidence: null`
  (an exact-key match, or a fuzzy one a human has since confirmed via the Library Connectors "Needs
  review" UI) — a pending suggestion no longer counts as owned until confirmed.
- **Disabled library connectors' stale videos still counted as owned.** Disabling a Plex/Jellyfin
  connector only flipped `LibraryConnector.enabled` — it never touched that connector's previously
  synced `LibraryVideo` rows, and three separate queries (the Library summary's availability CTE, the
  Artist Detail route, and backlog search's eligibility filter) read `LibraryVideo.available` without
  checking the parent connector's `enabled` state. A disabled connector's last-known-available videos
  therefore stayed "owned" forever and kept blocking search. All three now also require
  `connector.enabled: true`, matching the pattern already used correctly elsewhere in the codebase for
  the same relation.
- **VEVO-tier YouTube candidates bypassed content-type validation entirely.** `autoSearchAndGrab`
  auto-accepted any `vevo`-tier heuristic match without ever calling `validateCandidate` — but
  `youtubeMatch.ts`'s VEVO-tier detection is a bare case-insensitive substring check on the channel
  name ("vevo" appearing anywhere in it), not a verified-channel or IMVDb signal, so it's spoofable
  and provided no real backstop against a lyric video, visualizer, or teaser uploaded to a
  VEVO-named channel. Every heuristic-search candidate is now validated regardless of tier, including
  bounded motion analysis even when its uploader is verified. The IMVDb-sourced-link bypass is
  unchanged and is not a bug: it's the request doc's own
  explicit carve-out ("Accept these automatically only when IMVDb explicitly identifies the exact item
  as the official video"), now called out with a comment citing that line.
- **Download-queue deduplication had a TOCTOU race, and `grabFromIndexer` could orphan a download.**
  Both grab paths checked for an existing active queue item and created a new one as two separate,
  unsynchronized steps — two near-simultaneous grab attempts for the same video (a double-click, a
  retried request, a manual grab racing the scheduler) could both pass the check before either insert
  landed, creating duplicate queue rows. `grabFromIndexer` additionally sent the download to the
  external client *before* recording the queue row, so a failure in between left an actual external
  download with zero local record of it. Fixed with a database-enforced partial unique index
  (`DownloadQueueItem(musicVideoId)` over all active/uncertain states, migrations
  `20260921045136_grab_queue_dedup_unique_index`) as the authoritative guard — the existing check is
  now just a fast-path — and by reordering `grabFromIndexer` to create the queue row first. Ambiguous
  submission failures retain that row in `submissionUnknown` so retries cannot duplicate remote work.
- **Image proxy's SSRF blocklist was bypassable via a single redirect.** `safeImageFetch.ts` validated
  a user-supplied poster URL against a private/reserved-address blocklist, then fetched it with
  `fetch()`'s default `redirect: 'follow'` — a 3xx response could silently retarget the request at
  `127.0.0.1`, an RFC1918 address, or the cloud-metadata address (`169.254.169.254`) with zero
  re-validation, defeating the blocklist in one hop. Redirects are now followed manually, one hop at a
  time (capped at 5), with every redirect target re-validated through the same check before it's ever
  fetched. The separately-documented DNS-rebinding gap (a public hostname that itself resolves to a
  private address) is unchanged — it remains a deliberately accepted limitation for this app's
  single-admin-key threat model, not something this fix addresses.
- **A bare `/\bcover\b/` title pattern rejected real official videos.** YouTube content-type
  classification (Phase 3) rejected any title containing the word "cover" as a whole word — including
  a legitimate official video whose actual title contains it (e.g. Bruce Springsteen's "Cover Me").
  The check now only fires for actual fan-cover title conventions (parenthesized/bracketed, dash-
  suffixed, or qualified as "acoustic cover"/"cover of X"/"cover version"), not any bare occurrence of
  the word.

### Added — YouTube/VEVO acquisition validation and decision records ("Phase 3")

Closes the last two items on the plan's deferred list: the request doc's "provider-neutral
acquisition source records" and "YouTube/VEVO content validation" turned out to be one piece of
work — a validation decision *is* the acquisition-source record. Every YouTube candidate is now
either accepted, rejected with a reason, or held for review; a rejection or review no longer
vanishes with no trace.

- Before grabbing a heuristically-matched YouTube candidate, vidarr now fetches its real metadata
  (description, channel, verification status) and classifies it: an auto-generated "- Topic"
  channel, a "Provided to YouTube by..." label upload, or a title matching a lyric/karaoke/
  visualizer/reaction/cover/live/instrumental/trailer pattern is rejected outright; remaining
  candidates, including verified uploaders, require visual validation.
- Such a candidate is resolved by downloading a bounded ~20-second low-quality sample clip
  (not the full file — the request doc explicitly rules out downloading an entire file solely for
  validation) and reusing the existing freeze-frame motion check against just that sample.
- A rejected or held-for-review candidate is recorded as a History event with its reason, and no
  longer silently falls through — the History page now shows that reason in a new Details column.
  VEVO-tier heuristic matches follow the same validation path; only an exact IMVDb-authoritative
  source receives the specification's automatic-accept carve-out.
- The YouTube channel/playlist poll job applies the same metadata-only rejection patterns before
  grabbing (no bounded sample download there — a configured channel is a source the user already
  trusts, a different context from an autonomous broad search); the existing post-download
  `assertIsRealMusicVideo` check remains the final safety net either way.
- Deliberately does not add duration-based validation (no expected duration exists on either side
  to compare against, consistent with skipping duration in Phase 2b's reconciliation for the same
  reason) or a separate "AcquisitionSource" table (the existing `History` model already has the
  exact shape needed).

### Added — confidence-classified library reconciliation ("Phase 2b")

Media-server syncing previously matched a scanned video to vidarr's catalog through exactly one
exact, normalized artist+title key — anything else (a live version, a remaster, "(Official Video)"
left in one title but not the other) was reported as fully unmatched even when a human would
recognize it instantly.

- A sync now also tries a fuzzy, title-similarity fallback (scoped to the same artist's known
  videos) when the exact key misses, classifying what it finds as **probable** or **ambiguous**
  rather than silently accepting or silently dropping it. An exact match is unaffected — still free,
  still instant, still needs no review.
- The Library Connectors page has a new **Needs review** column next to Unmatched videos: each
  proposed match shows a confidence label and a side-by-side comparison (what the server reported vs.
  what it's proposed to match), with Confirm/Reject actions. Confirming makes it behave exactly like
  a normal match from then on; rejecting clears it and — this was the part missing entirely before —
  the next sync won't just immediately re-propose the same rejected candidate.
- Deliberately does not build the request doc's literal 12-state model as one enum, or add duration
  as a matching signal (no field for it exists on either side, and no provider fetches one today) —
  see the plan file's Phase 2b section for the full reasoning.

### Added — video ownership/acquisition state ("Phase 2a")

Picks up the next item from Phase 1's deferred list: the video-state model and Artist Detail page
rework, plus real search-eligibility gating and duplicate-queue-entry prevention (both explicitly
named in the request doc, and confirmed by research for this phase to be completely unenforced
today). Deliberately does **not** build the request doc's full 12-value state enum — see the
"Known gaps" note below for why, and what's still deferred.

- Each video on the Artist Detail page and in the Library accordion now shows real status badges —
  ownership (Local / On Server / Local + Server / Missing), an active download or a past failure,
  and an ignored flag — instead of the old flat "Downloaded"/"Wanted" text.
- Added a per-video **Ignore** toggle, independent of Monitor: an ignored video is always skipped by
  automatic search (even if monitored), and manual Search/Grab are disabled with a stated reason.
  Unlike Monitor, Ignore is never bypassed by a manual action — it means "don't touch this one."
- The scheduled backlog search now also checks that a video's **artist** is monitored, not just the
  video itself — previously an individually-monitored video on an unmonitored artist was still
  auto-searched, which contradicted the artist-level monitor toggle's whole purpose.
- A video that's already actively downloading, or already available locally or on a synced media
  server, is no longer picked up by automatic search again.
- Grabbing a release (automatic or manual) now refuses to start a second download for a video that
  already has one in progress — previously nothing prevented two overlapping grabs (a manual click
  racing the scheduled backlog job, for instance) from creating duplicate queue entries.
- Fixed a correctness bug in the Plex/Jellyfin sync's artist/video matching: a video's match to the
  vidarr catalog was being recomputed from scratch on every single sync, so a previously-good match
  would silently revert to unmatched the moment an artist or video title changed on either side, with
  no signal that it happened. A sync now only overwrites a match when it finds a genuinely new one.

### Known gaps against `docs/requests/2026-09-19-ui-enhance.md` (tracked for a later phase)

- The request doc lists twelve video states in one enum, but also says availability, acquisition,
  monitoring, and match quality "must not be collapsed into one misleading boolean" — which a single
  12-value enum would itself do (a video can be available on the server *and* show a stale failed
  download from an earlier attempt at a better copy; one enum value can't represent both). This phase
  computes ownership/acquisition/ignored as independent facts instead. Three states from the doc's
  list are still not built: `searching` (stays ephemeral, client-side-only state during an active
  search click), `queued` (the download-queue status value is never actually written by any code path
  today — a grab goes straight to `downloading` once the client accepts it), and
  `awaiting-server-scan` (would need new timestamp-comparison logic).
- ~~Confidence-classified reconciliation~~ — DONE in "Phase 2b" below. This phase only fixed the
  *existing* exact-match system so it stops silently dropping good matches; it did not yet add
  probable/ambiguous tiers on its own.
- ~~Provider-neutral acquisition source records and YouTube/VEVO content validation~~ — DONE in
  "Phase 3" above.

### Resolved without new work

- The Phase 1 plan deferred "true virtualization for thousands of artists" as a follow-up to real
  pagination. It doesn't need separate work: the Library page requests 25 artists per page, and the
  summary endpoint hard-caps `pageSize` at 200 server-side regardless of what's requested — the DOM
  never holds more than a bounded page of rows no matter how large the catalog is. Windowed
  rendering would only matter if the UI ever rendered an unbounded list at once, which it doesn't.

### Documentation

- Defined the canonical artist and music-video catalog, authoritative source priority,
  media-server delivery workflow, and playlist goals in `docs/product-vision.md`.
- Added repository instructions requiring tests and documentation updates with every applicable
  commit.
- Added a project skill (`.claude/skills/implement-feature-request`) documenting how a feature
  request document gets implemented: read it, echo the request back in plain language before
  writing code, size it up and phase it if large, then verify and document once it lands.

### Fixed — accessibility audit

The Phase 1 plan named "a full accessibility audit beyond what Phase 1's new components establish
on their own" as deferred work. A dimension-by-dimension audit across every page found and fixed:

- **Contrast**: solid buttons' white-on-accent text measured ~3.2:1 against WCAG's 4.5:1 minimum —
  button fills now use a separate, darker `--button-bg` token (~5:1). Input, select, and secondary
  button borders measured ~1.2-1.4:1 against their background (WCAG requires 3:1 for a UI control's
  boundary) — they now use `--text-muted` instead of the (still fine for purely decorative use)
  `--border` token. The Library page's active letter-rail highlight measured ~4.4:1 for its 11px
  text — its background tint is now lighter (darker composite) to clear 4.5:1. A batch-import
  group's card background matched the page background, leaving only the low-contrast border to show
  its boundary — the override is removed so it uses the normal, visible card background.
- **Form labels**: dozens of inputs and selects across Library, Library Connectors, Indexers,
  Download Clients, Quality Profiles, Root Folders, Playlists, Import, and Settings relied on
  `placeholder` text alone, which isn't an accessible name and disappears once a value is entered.
  All now have an explicit `aria-label` (or `<label>`).
- **Status announcements**: sync/test/save/search results across nearly every page (connector
  test/sync, indexer/download-client test, playlist generation and push, bulk import, artist
  metadata refresh, genre match, provider save, owner-account save) updated on screen with no
  `aria-live`/`role="status"`/`role="alert"`, so a screen-reader user had no way to know an action
  they triggered had finished, or what happened. The main Settings form and the recommendation
  provider rows previously gave no save feedback to anyone, sighted or not — they now show "Saved."
  or the failure reason.
- **Structural fixes**: the sidebar's primary navigation is now a real, named (`aria-label="Primary"`)
  list instead of a flat, unnamed run of links; the Library artist list's `role="list"` now has
  matching `role="listitem"` children; the playlist-generator's two match-mode radios now share a
  `name` so they behave as a real radio group; disclosure buttons (Library artist rows, Library
  Connectors' unmatched-videos toggle, a playlist's "Add videos" panel) now expose `aria-expanded`;
  repeated same-label buttons (Run Now, Save, Test, Edit, Remove, Dismiss, Add to Library, and more)
  now carry a per-row `aria-label` so they're distinguishable when a screen reader lists all buttons
  on a page; empty table header cells for an actions column now have visually-hidden text; two
  video-monitor checkboxes' accessible names dropped their own visible "Monitored" label text
  (WCAG 2.5.3); a disabled button's only explanation lived in a `title` tooltip in two places (Sync
  Play Counts, Push to library) — both now also show the reason as plain visible text.

### Changed

- The Library page no longer shows a flat grid of every media-server video. A video's media-server
  matches (screenshot, connector name, play count) now show inline on its artist's page instead, next
  to that specific video — matching the request doc's placement of official thumbnails on the Artist
  Detail page rather than the main Library list.

### Added

- Each video on the Artist Detail page, and in the Library page's per-artist accordion, now has a
  real monitor/unmonitor checkbox instead of static "Monitored"/"Unmonitored" text — the API already
  supported updating an individual video's monitored state; only the controls to reach it were
  missing.
- The Library Connectors page now shows, per connector, how many synced media-server videos have no
  matching vidarr artist/video at all, with an expandable list (title, artist, year) — closes the gap
  left by removing the old flat grid, which was the only place this was visible before. This covers
  definite non-matches only; reviewing a *low-confidence* match (something a sync did tentatively tie
  to the wrong video) is still the separately-tracked, deferred confidence-classified-reconciliation
  work — this list only ever contains videos with no candidate match whatsoever.

- The Library page is now artist-centered (Phase 1 of `docs/requests/2026-09-19-ui-enhance.md`):
  a vertical A-Z letter rail for navigation, a filter bar (search, genre, monitored state, "has
  missing videos"), and per-artist rows showing an image, known/available/missing/downloading video
  counts, and aggregate play count. Expanding a row lazily loads a compact video list. Multiple
  artists can be selected and bulk monitored/unmonitored at once, with partial-failure reporting.
  Filters and the current page persist in the URL.
- Artist images are now proxied through the server (mirroring the existing video-thumbnail proxy)
  so a connector's credentials never reach the browser — falls back from an explicit poster image
  to a matched Plex/Jellyfin library image.
- Added an inline "Edit" action to Indexers and Download Clients (matching the one already added to
  Library Connectors), so a wrong host, port, or credential can be corrected without deleting and
  re-adding the row.
- Added "minimum known videos" and "minimum play count" filters to the Library page's filter bar —
  the API and shared types already supported them, but the controls to reach them were missing.

### Changed

- New artists now default to **unmonitored** — adding one (manually, from IMVDb, or from a Discover
  recommendation) no longer immediately queues its whole catalog for download. Existing artists'
  monitored state is untouched; only the default for a brand-new row changed.

- Library connector syncs now surface synced artists as Discover recommendations and inventory the
  selected Plex/Jellyfin music-video library. The Library shows those videos as screenshot cards
  with title, artist, year, play count, source server, and Vidarr-catalog match status.
- Made owner username/password setup the normal first-run sign-in flow while retaining the API key
  for integrations.
- Updated Jellyfin authentication for Jellyfin 12's supported MediaBrowser authorization scheme.
- Made both connector library selectors user-selectable, renamed the video target to **Music Video
  library**, and clarified that the music library is used for artist matching.
- Restricted unauthenticated owner creation to the initial 30-minute bootstrap window, preserved
  API-key sign-in for upgrades from older installations, and made password hashing non-blocking.
- Added rate limiting for failed owner-login attempts and an explicit unavailable state when the
  web interface cannot verify server authentication status.

**Action required after upgrading**: existing Jellyfin connectors now need a Music Video library
picked explicitly — the migration that split the resolved Jellyfin user id out of the music-library
field clears the old auto-detected value, so the next artist sync for each Jellyfin connector will
fail until you open Library Connectors and choose a library from the new picker.

### Fixed

- The Library page's artist summary now counts a video as available (and includes its play count)
  when it's matched to a still-available video on a connected Plex/Jellyfin server, not only when
  Vidarr has a local file for it — previously a media-server-only video was reported as missing and
  contributed nothing to an artist's play count.
- The Library page's artist summary now filters, aggregates, and paginates at the database level
  instead of loading every artist's full video/file/queue history into memory on every request —
  fixes a real scalability gap for libraries with thousands of artists, found in a code review of
  the Phase 1 redesign.
- Hardened the server-proxied artist image endpoint against SSRF and unbounded resource use: a
  stored poster URL is now restricted to http(s), rejected outright if it's a loopback/private/
  link-local literal address, and its response is rejected if it isn't image content or exceeds a
  10MB size cap (checked as the response streams in, not just via a trusted Content-Length header).
  Found in the same code review — the endpoint previously did a bare, unbounded fetch of a
  user-suppliable URL.
- Closed a gap where creating the owner account via first-run setup did not close the one-time
  bootstrap API-key reveal endpoint: the raw key stayed retrievable, unauthenticated, for the rest
  of the 30-minute setup window even after an owner account had already been claimed.
- Removed a timing side-channel in username/password sign-in: a wrong username used to skip the
  password-hashing check entirely, while a wrong password always paid its full cost, making the two
  distinguishable by response time despite an identical error message.
- Fixed two library-connector sync bugs that could destroy previously-synced data: an artist sync
  that legitimately (or transiently) returned zero results was deleting every previously-known
  artist for that connector, and a video sync that failed partway through could leave every
  previously-known video marked unavailable instead of leaving prior state untouched.
- Fixed re-testing a Plex connector silently overwriting a manually-chosen Music library with the
  server's own guess.
- Fixed a Jellyfin video-inventory sync bug that could silently stop after the first page of results
  when the server's response omitted a total-count field.
- Fixed the sign-in screen showing a hard "Vidarr is unavailable" error for a user with an
  already-valid stored API key whenever just the login-status check hit a transient failure.
- Removed duplicated, untested thumbnail-fetching auth logic between the Plex and Jellyfin
  connectors in favor of one shared implementation.
- Capped unbounded memory growth in the failed-login rate limiter for long-running deployments.
