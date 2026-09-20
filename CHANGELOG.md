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

### Added

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
