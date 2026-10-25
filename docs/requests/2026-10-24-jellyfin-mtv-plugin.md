# Music-video-only Jellyfin MTV plugin

Request date: 2026-10-24. User authorized implementation after the subtitle/burn-in POC and
clarified that eligibility follows music videos themselves, regardless of playlist, while
movies and TV must retain their normal behavior. This supersedes playlist-only activation and
dedicated-user/global-subtitle-default proposals.

## Required behavior

- Independent Jellyfin server plugin, installed separately from Vidarr and from archived clients.
- Only Jellyfin `MusicVideo` items in administrator-selected music-video libraries qualify.
  Movies, episodes, audio, generic videos, unselected libraries and foreign subtitle tracks do not.
- Generate tiny ASS sidecars from Jellyfin's existing item metadata (including imported NFO data).
  Fixture defaults are artist/title/album/video year/director/MTV, missing fields hidden, first
  and last six seconds, with editable timing/text size. Do not infer album dates as video dates.
- Automatic activation selects the plugin's owned track during normal playback negotiation;
  do not change user subtitle defaults or require modified Roku/Web clients.
- Default disabled, no libraries preselected. Provide an authenticated administrator settings
  page, explicit generation action and visible running/progress/error state. New/edited metadata
  is applied through Generate / refresh, not an undocumented automatic media rewrite.
- Only generated subtitle content may be updated. Verify ownership/content hash, preserve
  foreign/edited subtitles and back up prior generated content. Never rewrite/copy original video.
- Subtitle burn-in may transcode video and use Jellyfin's normal transient storage. Do not claim
  Direct Play with a burned overlay or simultaneous ordinary captions and the info track.
- Disabling automatic activation preserves normal playback negotiation. Preserve generated files
  for recovery; no destructive mass cleanup or original-media deletion.

## Implementation boundary

Pin to the installed Jellyfin 12.3.0 public assemblies/.NET 10. Use the plugin service-registration
interface plus an ASP.NET action filter on POST playback negotiation. Only a matching local
primary-source `MusicVideo` with a current owned generated track receives an index override.
Other actions and alternate/unknown source IDs pass through. Fail open on lookup/ownership
errors. Administration endpoints require elevated authentication.

## Acceptance and verification

1. Build against the installed server assemblies and package a standalone DLL without copied
   Jellyfin runtime dependencies.
2. Rendering/ownership tests include timing, missing metadata, subtitle injection resistance,
   idempotence, original-byte preservation and edited/foreign file refusal.
3. In a separate server, a user with subtitles off receives the owned track and a burn-in offer
   for generated music videos, even when the client sends a disabled subtitle index.
4. The same user's movie and episode controls receive no automatic overlay; their defaults remain
   unchanged. Disabling the plugin restores normal music-video negotiation.
5. Anonymous/ordinary users cannot run administrator controls. Metadata text is rendered as text
   on the configuration page; never execute provider-supplied markup.
6. Production install/test must preserve configuration and existing media, use bounded test
   scope first, and distinguish server integration evidence from physical Roku confirmation.

See `integrations/jellyfin-mtv-plugin` for the implementation and build/lab evidence. The earlier
POC confirmed physical Roku display only under a temporary user-wide subtitle-default change;
that test was rolled back. It does not by itself verify the new plugin's client behavior.

Implementation evidence: 30 core tests pass; final isolated-server integration verifies automatic
selection with subtitles None, unchanged movie/episode behavior, preserved source bytes/defaults,
disable recovery and rejection of anonymous/ordinary-user administrator calls. The plugin is now
installed in production; the initial test-only scope covered three synthetic MTV Overlay Test clips. All three
pass automatic selection/burn-in negotiation with baseline preferences, libraries and playlists
preserved. On 2026-10-25 the user confirmed titles at both ends on official Roku after reopening
the test playlist without manual subtitle selection. The initial Web check exposed Jellyfin's
omitted-source selection behavior. Version 0.1.1 supplies the primary source ID only for eligible
music videos; both request styles pass isolated integration, and production Web visually confirms
automatic intro/outro display and a clear middle window after seeking. The user authorized the
real-library rollout, and generation created 4,266 sidecars while preserving three unreadable MP4s
without invented duration/timing. Original video sizes and modification times are preserved.
The 0.1.1 full refresh queue indexed too slowly. Version 0.1.2 instead appends the owned subtitle
through Jellyfin's public stream repository, preserving all existing stream identities/indexes.
Its final isolated integration passes with a fresh control and ordinary subtitle. It is staged
for an idle production restart; activation remains off pending registration/verification for all
valid videos. The user-confirmed deletion of two unrelated playlists is retained as an explicit
baseline exception; neither deletion was issued by this integration.
