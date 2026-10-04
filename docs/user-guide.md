# Vidarr user guide

Vidarr organizes **official song music videos** around confirmed artists. It can discover videos from IMVDb, an artist's YouTube links, and video files already in your library; it can then search for missing videos, download them, and track availability in a media server.

This guide covers the web app. For installation and Docker setup, see the [README](../README.md) and [deployment guide](deployment.md).

## Start here

1. Open Vidarr and complete the owner account sign-in if prompted.
2. In **Settings → Root Folders**, add the destination for organized music videos. For Docker,
   enter the absolute path *inside the Vidarr container*, such as `/media/music-videos` or
   `/mnt/d/media/music-videos`. Do not enter a Windows host path such as `D:\media`; Docker must
   first mount that host folder and the Root Folder must use the mount's container-side path.
3. In **Settings → Quality Profiles**, review the qualities Vidarr may accept. Choose a root folder and quality profile when adding an artist.
4. Optionally add Plex, Jellyfin, or Navidrome under **Settings → Library Connectors**. Use **Test** to check the connection and **Sync** to read artists and, for Plex or Jellyfin, inventory the selected video library.
5. Review artist names in **Match Review**. Only confirm the correct MusicBrainz artist. Confirmed artists appear in **Library**.
6. Open an artist and check **Video sources**. Review possible YouTube and local videos in **Video Review** before they enter the catalog.

Indexers and download clients are optional for cataloging, but configure them under **Settings** if you want Vidarr to search those sources and send downloads to a client.

## How the library works

**Artist → music video** is the Library structure. Audio tracks can suggest an artist during a connector scan, but audio tracks are never added as music videos. The artist must first be matched to a MusicBrainz identity. Names such as `311VEVO` are upload-channel names, not artist identities.

| Term | Meaning |
| --- | --- |
| Artist observation | A name found in a scan or import that still needs identity review. It appears in **Match Review**. |
| Confirmed artist | A MusicBrainz-matched artist shown in **Library**. Several observations can point to the same artist. |
| Video candidate | A possible song video from YouTube or a local file. It waits in **Video Review** until approved or rejected. |
| Known video | An approved song music video in an artist's catalog. It may still be missing from your playable library. |
| Available video | A video with a local Vidarr file or a confirmed media-server library match. |
| Monitored | A video or artist you want Vidarr to keep track of and search for when eligible. |
| Ignored | A catalog video you want to exclude from normal acquisition. |

An empty IMVDb listing does **not** mean the artist has no music videos. The other sources may still produce candidates. Vidarr does not fill an empty video catalog with audio releases.

## Add and confirm an artist

You can find artists in **Discover**, add one from **Library**, import a YouTube playlist, or sync a library connector. Names found through scans first go to **Match Review**.

1. Open **Match Review** and search for the observed name.
2. Expand its row and select **Find MusicBrainz matches**. If the scanned name is joined together or contains a guest credit, edit the **Search name** first. For example, search `Amy Winehouse` for `AmyWinehouse`; search the primary artist when the observation says `feat.` or `featuring` another performer.
3. Check the candidate's name, type, country, disambiguation, and recording evidence. Select **Confirm artist** only for the correct identity.
4. If that MusicBrainz artist is already in Library, Vidarr links the new observation to the existing artist rather than creating a duplicate. The original connector evidence is retained.

After confirmation, Vidarr starts collecting that artist's video sources. The collection may continue after the confirmation response. Reopen the artist page to see its latest source-check time and any error.

## Review the video catalog

Open an artist in **Library**. The compact **Video sources** panel shows IMVDb videos, approved videos from other sources, and candidates waiting for review. Expand it to see the source-check time, linked channels, and **Refresh all sources**. A source-check error is shown there rather than hidden.

Vidarr starts with three sources:

1. **IMVDb:** the artist's music-video videography, where present.
2. **YouTube:** channels linked to the confirmed artist, including YouTube Music relationships. The **YouTube Sources** section also lets you add a channel, playlist, or video URL and sync it.
3. **Local files:** existing videos scanned from the configured library paths. Use **Scan local videos** on **Video Review** to run a scan.

YouTube and local findings can be uncertain. Open **Video Review** or the artist's **Review candidate videos** link, inspect the source, choose the correct confirmed artist, correct the song title if needed, and select **Approve song video** or **Reject**. Approve only an official music video of a song. Reject interviews, live performances, lyric videos, visualizers, audio uploads, static artwork, and unrelated clips, even if their title or channel says “official.” A video's YouTube publication date appears when the source provides it; a missing date means Vidarr does not know it.

You can use **Add Video** on an artist page for a song video missing from the collected catalog. **Refresh IMVDb** checks that source's artist metadata; **Refresh all sources** checks the broader source record.

## Find and acquire missing videos

On an artist page, each video shows its ownership and acquisition state. **Missing** means Vidarr has no accepted local file or confirmed media-server match for it. **Queued**, **Downloading**, **Importing**, and **Awaiting server scan** describe progress toward availability; **Failed** requires attention.

- Turn on **Monitored** for an artist and the videos you want tracked. **Monitor all**, **Unmonitor all**, and **Monitor missing** change many videos at once.
- Use **Search** on one video, **Search Selected** for checked videos, or **Search missing monitored** for eligible videos on the artist page. **Search all eligible** on Library searches across eligible artists.
- Use **Download Selected** when selected missing videos have accepted direct sources. The button count is the number Vidarr can directly download; it can be smaller than the selection count. Failed items remain selected for retry.
- Use **Ignored** for a known video you do not want acquired. **Reconcile inventory** checks an artist against current local and media-server inventory.

Vidarr prefers an IMVDb curated direct link, then a plausible official VEVO or artist-channel source, and then a configured indexer and download client. A search result is a candidate, not proof that the file is a music video. Vidarr validates downloaded files for a real, moving video stream before accepting them. Set your preferred destination and quality in **Settings → Root Folders** and **Quality Profiles**. Check **Queue** for active work and **History** for previous events and failures.

## Other pages

| Page | What to do there |
| --- | --- |
| **Discover** | Review artist recommendations from connected libraries and recommendation providers. Add an artist or dismiss a recommendation. |
| **Import** | Preview a YouTube playlist, select artists and videos, then submit them to Match Review and Video Review. Choose a root folder and quality profile before importing. |
| **Playlists** | Build a static list or generate one from filters such as artist, genre, year, ownership, or play count. Choose a playback library and push a playlist to a supported media-server connector. Use **Edit** to rename a playlist, change its library, or (for a smart playlist) change its rules and schedule. Reorder a static playlist with the arrows. See [Editing and removing playlists](#editing-and-removing-playlists). |
| **Calendar** | See recently added monitored videos, newest first. Vidarr generally knows a release year rather than an exact release date. |
| **Queue** | Watch active acquisitions and imports. |
| **History** | Inspect completed activity and review or acquisition failures. |

Under **Settings**, **General** contains library naming and integration settings; **Quality Profiles** controls acceptable formats; **Root Folders** sets destinations; **Library Connectors** configures media-server reads and playback libraries; **Indexers** and **Download Clients** configure search and acquisition; **System / Tasks** shows maintenance jobs and manual run actions.

## Editing and removing playlists

Open **Playlists** and choose **Edit** on a playlist.

- **Rename** changes the name in Vidarr only. Choose **Update on …** to push it again; a push replaces the published copy, so the new name appears in Plex or Jellyfin.
- **Playback library** binds a playlist to one Plex or Jellyfin video library. A playlist that is already published cannot change library until you choose **Remove from …** on the old one, so no copy is left behind. A static playlist can only move to a library that has all of its videos.
- **Smart playlists** also let you change the filters, match mode, order, and regeneration schedule. Saving re-runs the rules at once, and republishes the playlist if it was already published and its videos changed.
- **Static playlists** are reordered with the up and down arrows. The order shown is the order pushed to the media server.

**Remove from …** takes the playlist off one media server and keeps it in Vidarr. **Delete playlist** also removes it from every server it was published to, unless you choose **Delete, keep it on …**. If a media server cannot be reached, the playlist is still deleted and the page tells you which server still holds a copy so you can remove it there.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| A playlist push fails or keeps the old playlist | The error under the push button says why. A published playlist is never replaced while any of its videos is missing from the library: run **Reconcile inventory** on the connector, or remove the missing videos. A playlist with no videos available in that library cannot be pushed. |
| An artist is absent from Library | Look in **Match Review** and confirm the correct MusicBrainz identity. A duplicate observation may already be linked to a confirmed artist. |
| Artist has no known videos | Expand **Video sources** and check the source-check time or error. Try **Refresh all sources**; review pending candidates. An empty IMVDb catalog is valid. |
| A YouTube upload is missing | Verify the confirmed artist's linked channel or add the correct URL in **YouTube Sources**, then sync. Check **Video Review**; excluded live, interview, lyric, and audio uploads do not become catalog videos. |
| A local video is missing | Check that the path is mounted inside Vidarr, run **Scan local videos**, and review the candidate and artist identity. |
| Search or download finds nothing | Check monitoring and ignored flags, configured sources, root folder, quality profile, and any **Queue** or **History** error. **Download Selected** needs an accepted direct source. |
| A file imported but is not yet available on Plex or Jellyfin | Check that the root folder targets the correct video library, run **Reconcile inventory**, and allow the media server to scan. Ambiguous matches may need review. |
| A connector cannot sync | Use its **Test** action, check the server address and credentials, then verify the selected library. |

For configuration and deployment details, see the [README](../README.md) and [deployment guide](deployment.md). For the intended catalog rules and future direction, see the [product vision](product-vision.md).
