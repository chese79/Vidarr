# Changelog

All notable user-visible and operational changes to Vidarr are documented here. New work is added
under **Unreleased** in the same commit as the change.

## Unreleased

### Documentation

- Defined the canonical artist and music-video catalog, authoritative source priority,
  media-server delivery workflow, and playlist goals in `docs/product-vision.md`.
- Added repository instructions requiring tests and documentation updates with every applicable
  commit.

### Changed

- Made owner username/password setup the normal first-run sign-in flow while retaining the API key
  for integrations.
- Updated Jellyfin authentication for Jellyfin 12's supported MediaBrowser authorization scheme.
- Made both connector library selectors user-selectable, renamed the video target to **Music Video
  library**, and clarified that the music library is used for artist matching.
- Restricted unauthenticated owner creation to the initial 30-minute bootstrap window, preserved
  API-key sign-in for upgrades from older installations, and made password hashing non-blocking.
- Added rate limiting for failed owner-login attempts and an explicit unavailable state when the
  web interface cannot verify server authentication status.
