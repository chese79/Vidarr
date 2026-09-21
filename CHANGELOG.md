# Changelog

All notable user-visible and operational changes to Vidarr are documented here. New work is added
under **Unreleased** in the same commit as the change.

## Unreleased

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
