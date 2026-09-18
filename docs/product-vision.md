# Vidarr product vision

Vidarr is a self-hosted music-video catalog, acquisition, library-management, and playlist system.
Plex and Jellyfin are not merely export targets: their libraries are primary inputs to Vidarr's
catalog and the playback destinations for the finished collection.

## Canonical catalog

Vidarr maintains one canonical artist list formed from the normalized union of:

1. artists in every selected music library;
2. artists credited on videos in every selected music-video library;
3. artists added manually; and
4. artists accepted from discovery services such as Spotify, Last.fm, or MusicBrainz.

Source provenance must be retained so Vidarr can explain why an artist exists and reconcile
removed or renamed library entries without deleting a manually managed artist. Synchronizing a
connector must be repeatable, deduplicate equivalent names, and remove stale connector-owned
records safely.

The selected music-video library also establishes the owned-video inventory. Vidarr should know
which canonical videos already exist in each media server, even when Vidarr did not originally
download them. Local file ownership and availability in a connected server are related but
distinct states.

## Discovery and acquisition

For a canonical artist, the user can discover the artist's music-video catalog, select wanted
videos, search for sources, and download a chosen or automatically selected result.

Preferred source order:

1. an authoritative IMVDb source URL, including YouTube or Vimeo;
2. a confidently matched official artist or VEVO upload on YouTube;
3. another user-reviewed YouTube or Vimeo result; and
4. a configured Torznab/Newznab indexer and download client.

Source records should be provider-neutral and retain the provider, external identifier, URL,
authority/confidence, and discovery origin. `yt-dlp` can perform the actual transfer for supported
video sites, but the domain model must not assume every direct source is YouTube.

## Media-library delivery

Completed downloads are organized into the configured root folder with predictable names,
metadata sidecars, and artwork. Each root folder should be explicitly associated with the target
Plex or Jellyfin music-video library when possible.

After import, Vidarr should request a media-server library refresh, wait for or later reconcile the
new server item, and surface whether the file is merely on disk or fully available in the player.
Existing files and media-server records must never be deleted merely because a connector sync
temporarily fails.

## Playlists

Vidarr creates playlists only from videos available in the selected playback library and can send
them to Plex or Jellyfin. Users can build playlists manually or from metadata rules such as artist,
genre, year, play count, ownership, quality, date added, director, or other catalog metadata.

Static playlists are snapshots. Smart playlists retain their rules, can be regenerated on demand
or on a schedule, and can republish when membership changes. Playlist ordering must be explicit
and deterministic, with optional shuffle/randomization as a user choice.

## Current alignment priorities

1. Synchronize artists from both selected music and music-video libraries into the canonical
   catalog while retaining provenance.
2. Inventory existing music videos from Plex and Jellyfin and reconcile them with canonical video
   records.
3. Generalize authoritative sources to support IMVDb-provided YouTube and Vimeo links.
4. Map imports to connector libraries and trigger/reconcile media-server refreshes.
5. Expand static playlist filters and add persisted smart-playlist rules.
6. Validate the Plex connector end to end against a real Plex server.

