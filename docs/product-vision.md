# Vidarr product vision

Vidarr is a self-hosted music-video catalog, acquisition, library-management, and playlist system.
Plex and Jellyfin are not merely export targets: their libraries are primary inputs to Vidarr's
catalog and the playback destinations for the finished collection.

## Canonical catalog

Vidarr first observes artists from configured audio libraries, video libraries, manual additions,
and discovery services. An observation is not itself a canonical identity. The preferred identity
pipeline is:

1. consume an embedded or connector-provided MusicBrainz artist ID when available;
2. otherwise propose MusicBrainz candidates using exact names, aliases, and supporting evidence;
3. require review for ambiguous or name-only matches; and
4. retain the selected MusicBrainz ID as the stable canonical artist identity.

MusicBrainz supplies canonical names, aliases, artist type, country, disambiguation, genres, and
recording relationships. Picard data is consumed from tags embedded in audio files or exposed by a
media server; Vidarr does not depend on a separate Picard database. Genre precedence is user value,
embedded Picard metadata, MusicBrainz genres, connector metadata, then folksonomy data.

When a read-only audio path is configured, Vidarr retains connector-scoped observations for only
the files present there: title, album, credited artist, album artist, track/disc positions, genre,
and embedded MusicBrainz artist, recording, release, and release-group IDs. These observations are
matching evidence, not a request to import the artist's complete MusicBrainz discography. A fully
empty scan preserves prior observations because the mount may be temporarily unavailable.
During artist match review, Vidarr may look up a bounded sample of those observed recording and
release IDs to compare MusicBrainz artist credits with proposed candidates. Credited evidence
helps rank candidates but never confirms a name-only match without user review.

Artist observations are formed from the normalized union of:

1. artists in every selected music library;
2. artists credited on videos in every selected music-video library;
3. artists added manually; and
4. artists accepted from discovery services such as Spotify, Last.fm, or MusicBrainz.

Source provenance must be retained so Vidarr can explain why an artist exists and reconcile
removed or renamed library entries without deleting a manually managed artist. Synchronizing a
connector must be repeatable, deduplicate equivalent names, and remove stale connector-owned
records safely.

After artist identity is resolved, IMVDb defines the authoritative list of expected official music
videos. IMVDb completeness is therefore separate from source discovery and local ownership.
MusicBrainz recording/video relationships may add supplementary videos and verified source URLs,
but supplementary videos are unmonitored by default and never change IMVDb completeness. Artist
channel links are discovery hints, not proof that an individual upload is an official video.

The selected music-video library also establishes the owned-video inventory. Vidarr should know
which canonical videos already exist in each media server, even when Vidarr did not originally
download them. Local file ownership and availability in a connected server are related but
distinct states. A local video matching the artist but not an IMVDb video remains visible as
inventory alongside the official catalog and is not silently discarded or counted as expected.

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
Plex or Jellyfin music-video library when possible. Connector sync preserves this inventory as
provenance-aware records and presents each item in Library with media-server artwork and basic
metadata; availability there remains distinct from Vidarr's local-file ownership state.

After import, Vidarr should request a media-server library refresh, wait for or later reconcile the
new server item, and surface whether the file is merely on disk or fully available in the player.
Existing files and media-server records must never be deleted merely because a connector sync
temporarily fails.
An unexpectedly empty video-library scan also preserves the last known availability; a later
non-empty scan reconciles inventory. Video-library provenance is retained even when the artist
was already observed through an audio library.

## Playlists

Vidarr creates playlists only from videos available in the selected playback library and can send
them to Plex or Jellyfin. Users can build playlists manually or from metadata rules such as artist,
genre, year, play count, ownership, quality, date added, director, or other catalog metadata.
The playlist picker and filter generator include confirmed media-server videos even when Vidarr
does not own a local file. A push uses server-only items only when they are available in that
specific connector.

Static playlists are snapshots. Smart playlists retain their rules, can be regenerated on demand
or on a schedule, and can republish when membership changes. Playlist ordering must be explicit
and deterministic, with optional shuffle/randomization as a user choice.
Smart rules are stored with the playlist and regenerate atomically in artist/title order. The
scheduler checks daily or weekly rules every 15 minutes; users can also regenerate manually.
Existing static playlists and their item order are preserved by the additive migration.

## Current alignment priorities

1. Use the observed release/recording set as supporting evidence for ambiguous artist matches.
2. Inventory existing music videos from Plex and Jellyfin and reconcile them with IMVDb official
   records while preserving supplementary inventory.
3. Generalize authoritative sources to support IMVDb-provided YouTube and Vimeo links.
4. Map imports to connector libraries and trigger/reconcile media-server refreshes.
5. Expand static playlist filters and add persisted smart-playlist rules.
6. Validate the Plex connector end to end against a real Plex server.
