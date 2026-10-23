# Native MTV overlay

Direction changed on 2026-10-19: abandon pre-rendered video copies and draw the information block
inside the playback client. The undeployed pre-render renderer, job APIs/settings, migration,
worker, UI and optional image dependencies have been removed from the Vidarr source.
The local service never received that migration; no deployed data or media needs to be removed.

## Required behavior

- Draw `MTV`, artist, quoted song title and available album/year at the lower left of the video.
- Use Jellyfin's item metadata, including values imported from video/NFO metadata. Do not require
  clients to read filesystem sidecars or expose media-server credentials through a new service.
- Show the block while playback position is below six seconds, and during the final six seconds
  when a finite, positive duration is known. Short videos have one continuous overlapping window.
- Follow the player's media timeline through pause, buffering, seek, resume and playlist changes.
  Clear stale text immediately when the item changes. Hide the block after stopping/unloading.
- Omit missing fields and render metadata as literal text. Unknown duration permits intro display
  only; do not guess an outro start time. Keep the block within the safe display area.
- Provide an optional client setting and restrict the initial feature to music-video items.
- Preserve original video bytes, Direct Play eligibility, HDR, audio/subtitle tracks and existing
  playback/reporting/count workflows. The overlay adds no transcode, cache or derivative files.

## Client integration boundary

A native overlay is player-side code. Vidarr can continue producing its existing metadata, but a
Vidarr server feature or Jellyfin server plug-in cannot add a SceneGraph component to the standard
Roku app. Roku support requires changes to the Jellyfin Roku client, delivered as a modified client
or accepted upstream contribution. Web support needs a separate Jellyfin web integration. Neither
client implementation is supplied merely by installing or rebuilding Vidarr.

The user selected both Roku and web. The separate source components and compatibility-checked
installer are in [`integrations/jellyfin-native`](../integrations/jellyfin-native/README.md).
Roku uses a SceneGraph group, fed from the already loaded item metadata and scalar fields forwarded
by the player's existing position/state handlers; it holds no reference back to its parent video.
Web mounts literal DOM text inside the HTML video container, attaches media event
listeners, accounts for transcoding offsets and disposes the old block on play/stop/destroy.
Neither component changes media URLs, playback commands or reporting hooks.

Each setting defaults off: Roku Settings → Playback (existing per-user storage), and web user
Playback settings (existing device/browser app storage). Roku uses the existing FHD scene safe
area. Web uses relative viewport sizing in Jellyfin's fullscreen player container. Native video
fullscreen and video picture-in-picture do not compose sibling DOM elements; casting/external
players are separate clients and are outside these components.

Source compatibility is pinned to the exact revisions in `bases.json`, not every version carrying
the Jellyfin name. The installer refuses edits/incompatible files before mutation, supports a
check-only run and retains originals for removal. Removal checks installed hashes before restoring
anything, so subsequent source edits are not silently overwritten. It does not modify a live
Jellyfin server, enable Roku developer mode or upload a channel. Client deployment and real-device
playback verification remain separate stages; no such deployment is claimed by source development.

## Workflow and verification contract

Choose supported client/build -> install the optional native overlay component -> enable its
setting -> play an existing music video -> observe intro/outro blocks on that same playback item.
No separate library, video rendering, derivative delivery or playlist substitution is required.
Normal acquisition, validation, import and original-file server confirmation remain unchanged.

Verify exact timing boundaries, missing metadata/duration, overlapping short-video windows,
paused/buffering/seeking/resumed playback, consecutive playlist items, stop/error cleanup,
literal text and display safe areas. Confirm original playback URLs/methods and reporting remain
unchanged. A Roku implementation additionally needs a compatible development build and on-device
verification; a web-only implementation does not establish Roku support.

## Implementation verification (2026-10-19)

| Requirement | Implementation | Evidence |
| --- | --- | --- |
| First/last six seconds, short/unknown duration | Pure timeline predicates in each client; original item duration and web transcode offset | Boundary and offset tests pass. |
| Imported artist/title/album/year, missing metadata | Existing loaded Jellyfin item; literal DOM text/Roku labels; music-video type guard | Metadata/fallback and literal-text tests pass. |
| Pause, buffering, seeking, resume, playlist replacement, stop | HTML media events with disposal; existing Roku state/position handlers forward scalar fields | DOM lifecycle and actual BrightScript controller tests pass, including replacing the item. |
| Optional, separate installation | Per-client playback setting, compatible-source installer, originals/checksum recovery | Both pinned-source dry runs, repeat installs, edit refusals and exact-byte removal tests pass. |
| Original media and playback reporting | Components only draw UI; no media URL, transport/reporting or database changes | Source integration review; live server/device playback-method comparison still required. |

The standalone Node 22 image passes **10 tests**, with no skipped installer checks. The final
Jellyfin Roku client compiles and packages under Node 22; its development ZIP is retained locally
at `integrations/jellyfin-native/build/jellyfin-roku-mtv-development.zip`. Upstream existing unused
parameter/variable warnings remain. This is not an on-device playback result. The full Jellyfin
web TypeScript check and minified production bundle also pass under its required Node 24 runtime.
The memory-bounded web build runs those stages separately and minifies serially, retaining full
production optimization. Upstream bundle-size warnings remain. Neither client has been deployed
to a live Jellyfin installation or Roku by this implementation work.

Local artifacts under `integrations/jellyfin-native/build/`:

- `vidarr-jellyfin-native-source.zip`: optional components, installer, tests and build instructions.
- `jellyfin-roku-mtv-development.zip`: compiled development channel for the pinned Roku source.
- `jellyfin-web-mtv-development.zip`: compiled web assets, with `index.html` at the archive root.

The extracted web output contains the overlay, HTML-player integration and user Playback setting
in their emitted chunks. Build dependencies/caches are excluded from the final web artifact image.
These local development artifacts require the compatibility and installation steps in the
[component guide](../integrations/jellyfin-native/README.md); they are not store/catalog releases.

References: [Jellyfin Roku source](https://github.com/jellyfin/jellyfin-roku),
[Roku Video position/duration events](https://developer.roku.com/dev/docs/video).
