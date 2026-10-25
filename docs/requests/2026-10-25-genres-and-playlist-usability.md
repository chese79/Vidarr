# Genres and playlist usability

Request date: 2026-10-25. The user requested all three genre concerns together: consistent
browsing/filtering, accuracy/cleanup, and genre-based playlists. They also reported playlist
generation appearing broken in the UI. Browser reproduction confirmed generation works in Music
Videos mode, but Live mode presents a disabled action and hides music-video playlists.

## Required outcomes

1. Broad genres include their mapped subgenres consistently in Library browsing and playlist
   filtering. Specific subgenres match their normalized identity, not arbitrary substrings.
   Spelling aliases use the established taxonomy. Unknown/custom labels are retained.
2. Preserve artist genre precedence: user edits, then embedded/server metadata, then community
   candidates. Preserve all source candidates, manual edits, and provider-failure recovery.
   Source rows are marked in force only when that source contributes to the effective genre.
3. Genre browsing clearly links the complete broad-genre group to Library and offers a route
   into playlist generation using that genre. Counts and percentages keep their artist basis.
   Cleanup hints stay advisory; never merge/delete labels or change artists in bulk implicitly.
4. Playlist generation offers the same canonical genre choices, including parent genres. Keep
   legacy video genre metadata available as compatibility evidence, using the same matcher.
5. In Live mode, replace the misleading disabled Generate action with an explicit way to switch
   to the Music Videos generator. Explain that reviewed Live recordings use static playlists.
   Clearly distinguish no playlists at all from playlists hidden by the current catalog view.
6. Keep generation, membership review, Push and server confirmation as distinct required stages.
   Show pending/error/result feedback. A generated playlist is saved in Vidarr, not implicitly
   published. Preserve the target library, count, ordering, static/smart behavior and saved rules.

## Data and operational constraints

No destructive taxonomy cleanup, provider backfill, downloads, or source credential changes.
Do not alter existing saved playlist membership just because matching behavior improves; new
generation and explicit/scheduled smart regeneration use the consistent matcher. Keep filtering
before server pagination and avoid SQLite parameter-count limits. No schema change is planned.
Preserve the separately staged Jellyfin overlay update and active playback.

## Acceptance checks

- An artist tagged only trip hop is included by Electronic in both Library and playlist filtering;
  Electronic does not include unrelated labels merely containing the word. Aliases resolve equally.
- Exact subgenre filtering does not accidentally include another subgenre containing its name.
- Source attribution respects precedence even when lower-priority candidates use the same name.
- Broad-genre Library/playlist links use the same scope; custom and unknown values remain visible.
- The Live playlist page offers a working switch to generation and explains hidden saved playlists.
- Browser generation creates the requested small playlist, shows its result and leaves publication
  as an explicit Push. Automated tests cover filtering, precedence, links and catalog-mode controls.

## Implemented and verified

All criteria are implemented. Verification covers 129 backend tests across seven relevant files
and 41 web tests across seven files; the final browse-link correction also passes its affected
16-test UI subset. The initial backend run exposed one resource timeout and a test name whose
leading article changed its expected letter; the corrected two-file run passes all 32 tests.
Both production builds pass under Node 22.

Production browser checks confirm the Live action opens the generator, an Electronic genre link
prefills its rule, a three-video playlist is generated with progress/result feedback, and Push
remains explicit. Electronic statistics and complete Library browsing both show 73 artists; Rock
statistics and the protected Library query both show 335. Group links explicitly disable the
default hide-empty-artist filter. Manual edits and advisory cleanup behavior remain intact.

Deployed image: `vidarr-genres-20261025:final`, manifest
`sha256:dd279f0ac2da232893e3cb7a0e620c5314ac2a8991873077ab5cf065705de5aa`.
Vidarr is healthy at its existing local address. Only Vidarr was recreated; original mounts,
environment, explicit port binding, non-root user, configuration and catalog IDs are preserved.
The independently pending Jellyfin overlay rollout state was retained; no Jellyfin restart was
performed for this change. See [deployment recovery](../deployment.md).
