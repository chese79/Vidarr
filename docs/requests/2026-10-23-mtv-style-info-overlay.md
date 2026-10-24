# mtv style info overlay

Request date: 2026-10-23. Status: gathering requirements; implementation is not authorized
by this requirements discussion. This reopens design evaluation, not the archived prototype.

## Confirmed requirements

- Display an MTV-style information block at the lower left of the playing music video.
- Include artist, song title, album, music video release year, director and the literal `MTV` label.
- Hide fields whose metadata is missing; do not print `Unknown` or invent values.
- The year is the music video's release year, not the album/song release year.
- Show the block during the first six seconds and last six seconds of the video.
- Base metadata on the video/catalog/NFO data. Exact precedence and metadata delivery remain open.
- Keep overlay components independently installable from Vidarr's main application.

## Delivery decision reopened

The earlier proposal targeted native Jellyfin Web and Roku overlays without rendered copies.
The user explicitly selected **Reconsider the approach** on 2026-10-23. Neither native client
modifications, rendered copies nor transcoding is selected for the new design. Prior interest
in Roku/Web and all-client coverage supplies context, not a settled current support matrix.
Archived sources under `future/mtv-overlay` remain excluded from builds and deployments.

## Open decisions

1. Priority between standard Jellyfin app coverage (including Roku), Direct Play/no video copies,
   and installation/maintenance simplicity. A question is pending with the user.
2. Target clients, acceptable client/server installation changes, and handling unsupported players.
3. Per-user/client/global enablement, default state and whether overlays apply only to music videos.
4. Metadata precedence (catalog, NFO, Jellyfin), multiple directors and missing artist/title behavior.
5. Exact block styling, line order, optional labels, safe-area margins, text wrapping and animation.
6. Playback timing on seek, resume, pause, unknown duration and videos shorter than twelve seconds.

## Draft acceptance criteria

1. A fully described video shows artist, title, album, music-video year, director and the literal
   `MTV` label in the lower-left block.
2. Removing optional metadata removes its line without displaying placeholders or leaving gaps.
3. An album/song release year is never silently substituted for a missing music-video release year.
4. On uninterrupted playback of a video at least twelve seconds long with known duration, the
   block is visible from 0–6 seconds and during the final six seconds; it is hidden between them.
5. The final delivery decision explicitly states client coverage, installation location, impact
   on Direct Play/transcoding/storage, and recovery before implementation begins.

Further acceptance criteria depend on the outstanding product decisions. No media files,
Jellyfin installation or archived overlay components are changed during requirements gathering.
