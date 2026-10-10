# Video status and server delivery FAQ

## What happens after a download?

New installations default to Move. Vidarr places the video and its video-specific metadata,
artwork and subtitles in the configured root using the naming format (by default an artist folder,
a folder for each video, and an artist/title/year/quality filename). Separate video folders prevent
Jellyfin from grouping different songs as versions of one item, following its
[music-video organization guidance](https://jellyfin.org/docs/general/server/media/music-videos/).
It retains supplied NFO details, aligns canonical artist/title/year/director, preserves artwork and generates
missing metadata. The source is retained until import recording succeeds. Existing configured
Copy or Hardlink preferences survive upgrades and remain available in Settings.
The previous standard naming format upgrades to the separate-video layout; custom formats remain
unchanged. A malformed NFO or an existing destination belonging to another video stops import
without discarding the download.

Select the root's target Plex or Jellyfin video library in Root Folders. Both Vidarr and the server
must access the same files, even if Docker and the host use different path names. A server API
notification requests a scan; it does not upload files. Jellyfin reads music-video NFO metadata;
Plex metadata handling depends on its library agent.

## When is delivery complete?

Only after the selected server confirms cataloging. Until then the video shows **Awaiting server
cataloging**, even when its file is already safely in place. Vidarr retries scan notifications and
checks pending imports every five minutes. It
requires the server path to match the managed file below the root; an older copy elsewhere cannot
complete a new delivery. Vidarr notifies Jellyfin of filesystem changes in the selected library's
physical roots and requests metadata refresh so new video folders can be discovered.
An unmapped root needs a target selected; disabled or
unreachable servers and ambiguous matches leave delivery pending. Linking a target also queues
existing managed files that lack confirmed ownership in that target library.

## What do Known, Available, Missing and Local mean?

| Label | Meaning |
| --- | --- |
| Known | A preserved video record in Vidarr, whether owned or missing. |
| Available | A Vidarr-managed file or a confirmed available copy on an enabled server. |
| Missing | Neither a managed file nor a confirmed available server copy. |
| Local | Vidarr has recorded a managed file; server cataloging may still be pending. |
| On server | A connected server confirms an available matched copy. |
| Local + server | Both ownership facts are true. |

Min local videos counts managed local files only. Complete means every known video is available;
it does not guarantee IMVDb catalog completeness or completed server delivery. Suggested fuzzy
matches do not count as owned until confirmed.

## What are Official, Supplementary, Inventory and Catalog review?

Official videos are expected entries from IMVDb. Supplementary videos are reviewed music videos
accepted outside that list. Inventory preserves existing videos without making them expected
official entries. Their counts are separate. Catalog review means an older entry is absent from
the latest IMVDb catalog; its record and files are retained for review. These classifications do
not describe whether a video is downloaded.

## What do Monitored and Ignored control?

Automatic missing-video acquisition and quality upgrades require both artist and video monitoring.
Ignored blocks automatic and direct manual downloads; unignore a video before downloading it.
Unmonitored videos may still be downloaded manually.

## What are the acquisition and review states?

Queued, Downloading and Importing describe active work. Submission unknown means the download
client may have accepted the request; it blocks duplicate submissions until resolved. Awaiting
server cataloging means file import succeeded but delivery is pending. Failed describes the latest
failed attempt for a missing video; old failures do not label a successfully owned video failed.
Past failures remain in history. A successfully cataloged video needs no active acquisition badge.

Video Review's Pending, Approved and Rejected apply to discovery candidates, independently of file
ownership or download progress.

## How are play counts calculated?

Library and artist detail use the managed file's known play count first, including zero. Otherwise
they use the highest count among confirmed available server copies. Multiple copies are not added
together. Unknown remains unknown, rather than becoming zero.
