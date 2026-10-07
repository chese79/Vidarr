# Vidarr product vision

Review queues use the same compact, expandable row pattern as the Library. Match Review is paged on the server so large observation sets remain quick to browse. The artist detail page keeps source diagnostics in a collapsed summary above the canonical video list.

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
media server; Vidarr does not depend on a separate Picard database. Genre precedence is the user's value,
then embedded Picard metadata or media-server genres, then MusicBrainz genres and Last.fm tags merged
as peers.

When a read-only audio path is configured, Vidarr retains connector-scoped observations for only
the files present there: title, album, credited artist, album artist, track/disc positions, genre,
and embedded MusicBrainz artist, recording, release, and release-group IDs. These observations are
matching evidence, not a request to import the artist's complete MusicBrainz discography. A fully
empty scan preserves prior observations because the mount may be temporarily unavailable.
During artist match review, Vidarr may look up a bounded sample of those observed recording and
release IDs to compare MusicBrainz artist credits with proposed candidates. Credited evidence
helps rank candidates but never confirms a name-only match without user review.

Match Review can search MusicBrainz with an edited name while preserving the original source credit.
Joined words such as `AmyWinehouse` and credits with `featuring`, `feat.`, or `ft.` use the primary
artist as a search hint. These conventions only improve suggestions; they never confirm an identity
without the normal MusicBrainz check. Confirmation reports provider failures and an existing
canonical owner plainly. If the selected MusicBrainz identity already belongs to a Library artist,
the observation is marked linked, its connector evidence is retained, and its pending video candidates
move to that artist. Linked observations stay out of Match Review and Library while their connector
identities remain stable for later scans. Once a new identity is confirmed, the slower source collection continues in the
background so the artist can appear in Library promptly.

Artist observations are formed from the normalized union of:

1. artists in every selected music library;
2. artists credited on videos in every selected music-video library;
3. artists added manually; and
4. artists accepted from discovery services such as Spotify, Last.fm, or MusicBrainz.

Source provenance must be retained so Vidarr can explain why an artist exists and reconcile
removed or renamed library entries without deleting a manually managed artist. Synchronizing a
connector must be repeatable, deduplicate equivalent names, and remove stale connector-owned
records safely.

For launch, only MusicBrainz-confirmed artists appear as top-level Library entries. An audio-track
credit or a video uploader name is an observation, not an artist identity. Unresolved observations
belong in a separate Match Review list until a MusicBrainz identity is confirmed. A channel such as
`311VEVO` may suggest the artist 311, but the channel name is never promoted as an artist.

After artist identity is resolved, IMVDb defines the authoritative list of expected official music
videos. IMVDb completeness is therefore separate from source discovery and local ownership.
MusicBrainz recording credits can support artist matching, but audio recordings never become
music-video catalog entries. Artist channel links are discovery hints, not proof that an individual
upload is an official video.

The selected music-video library also establishes the owned-video inventory. Vidarr should know
which canonical videos already exist in each media server, even when Vidarr did not originally
download them. Local file ownership and availability in a connected server are related but
distinct states. A local video matching the artist but not an IMVDb video remains visible as
inventory alongside the official catalog and is not silently discarded or counted as expected.

## Artist genres

An artist's genres have two levels: broad genres and the sub-genres that roll up into them.
MusicBrainz and Last.fm are both retained as per-source candidates and never collapsed into one value,
so the user can see where a genre came from and judge it. The genres in force are chosen from the
highest-precedence source that has any (see precedence above); the community tier merges MusicBrainz
and Last.fm, ranks a genre both agree on first, and caps the result so a well-known artist is not
buried in labels. Last.fm tags are free text and count only when they resolve to a MusicBrainz
genre. A user's edit is never replaced by a refresh, and a source that fails or answers empty never
removes stored genres. Library-wide counts are shown as a count and a percentage of Library artists
per genre and sub-genre so the user can decide whether consolidating is worthwhile; consolidation is
advisory. Songs do not carry their own genre: almost none have one in either source, so a video
uses its artist's genres.

## Discovery and acquisition

For a canonical artist, the user can discover the artist's music-video catalog, select wanted
videos, search for sources, and download a chosen or automatically selected result.
The artist page's Download Selected action grabs only checked videos with an accepted direct
source, leaves active or already owned videos alone, and reports individual failures for retry.

Preferred source order:

1. an authoritative IMVDb source URL, including YouTube or Vimeo;
2. a confidently matched official artist or VEVO upload on YouTube;
3. another user-reviewed YouTube or Vimeo result; and
4. a configured Torznab/Newznab indexer and download client.

The launch catalog has three discovery inputs: IMVDb's official music-video list; the confirmed
artist's YouTube and YouTube Music channels; and existing local video files. Other catalog inputs
are future scope. An empty IMVDb catalog is valid and does not cause audio tracks to be added as
videos. YouTube and local candidates are reviewed when their artist, song, or content type is
uncertain. Only an official music video for a song enters the launch catalog. Official interviews,
live performances, live songs, lyric videos, visualizers, and static-art or audio-only uploads do
not enter it. Live material may receive a separate category later.

Confirming an artist collects a source record for that artist: every IMVDb artist-credit video,
the uploads in each linked YouTube channel's Videos tab, and files in configured local video
roots whose filename or folder identifies the artist. The artist page can refresh this record
and show source counts, scan state, and pending review items. A direct IMVDb URL in MusicBrainz
resolves the artist slug; the public IMVDb videography is used when the API is unavailable.
When MusicBrainz has no IMVDb link, Vidarr checks the public artist page derived from the
confirmed name and uses it only if the page displays that same artist name.
MusicBrainz-linked IMVDb slugs may contain punctuation, so links such as R.E.M.'s are kept
verbatim. The artist page requests aggregate source counts separately from the complete
source-record endpoint to remain responsive with large channel inventories.
Video Review fetches bounded pages and applies artist and title search on the server; the
unpaginated API remains available for existing clients.
When YouTube and YouTube Music links point to the same channel, a collection checks the channel
once. A channel with no Videos tab contributes no candidates and is not an inventory error.
Repeat channel checks preserve unchanged review decisions and manual approvals.
Every review candidate records when Vidarr first and most recently saw it. YouTube channel feeds
also provide publication timestamps for recent uploads; older uploads can retain an unknown
publication date because the fast channel listing does not expose one. An approved video's known
YouTube publication time is separate from its IMVDb release year and Vidarr catalog-added time.
Repeat scans compare video IDs and titles across the full channel, so an old upload newly linked
to the artist or retitled later is still found; they batch last-seen updates for speed.
Repeated song titles may be distinct official video versions and must remain separate.
Connector-confirmed artists enter a persistent source-check queue as soon as the connector sync
finishes. The scheduler checks new artists first in bounded batches, continuing while work remains, and also backfills confirmed
artists from older catalogs. One local-file scan when the queue drains covers all confirmed artists; each
artist records the latest check time and any provider error so an empty catalog can be
distinguished from a scan that has not run.

Source records should be provider-neutral and retain the provider, external identifier, URL,
authority/confidence, and discovery origin. `yt-dlp` can perform the actual transfer for supported
video sites, but the domain model must not assume every direct source is YouTube.
When several accepted direct links exist, the automatic decision and downloader use the same
authority order: authoritative, verified, manual, then heuristic. Automatic search tries these
accepted links before searching for a new candidate; newly discovered YouTube candidates still
require validation.

## Media-library delivery

Completed downloads are organized into the configured root folder with predictable names,
metadata sidecars, and artwork. Each root folder should be explicitly associated with the target
Plex or Jellyfin music-video library when possible. Connector sync preserves this inventory as
provenance-aware records and presents each item in Library with media-server artwork and basic
metadata; availability there remains distinct from Vidarr's local-file ownership state.

After import, Vidarr should request a media-server library refresh, wait for or later reconcile the
new server item, and surface whether the file is merely on disk or fully available in the player.
Pending imports are checked against the root folder's selected playback connector every five
minutes. Only a unique exact artist/title match clears the pending state; empty scans, duplicate
matches, conflicting year or duration, and previously rejected matches leave it pending for later
review or retry.
Existing files and media-server records must never be deleted merely because a connector sync
temporarily fails.
During a quality upgrade, the previous file remains in place until the replacement is recorded
successfully; cleanup never removes a prior path outside the configured root folder.
An unexpectedly empty video-library scan also preserves the last known availability; a later
non-empty scan reconciles inventory. Video-library provenance is retained even when the artist
was already observed through an audio library.

## Playlists

Vidarr creates playlists only from videos available in the selected playback library and can send
them to Plex or Jellyfin. Users can build playlists manually or from metadata rules such as artist,
genre, year, play count, ownership, quality, date added, director, or other catalog metadata.
Ownership rules distinguish local-only, media-server-only, and both; quality rules use the local
file's quality. A date-added rule uses the canonical video's added time.
The playlist picker and filter generator include confirmed media-server videos even when Vidarr
does not own a local file. A push uses server-only items only when they are available in that
specific connector.
New static and smart playlists may be bound to one selected playback connector. A bound playlist
draws only from confirmed available videos in that connector, restricts manual additions to that
inventory, and pushes only to that connector. Existing unbound playlists preserve their current
behavior and order; users can select a playback connector when creating a new playlist.

Static playlists are snapshots. Smart playlists retain their rules, can be regenerated on demand
or on a schedule, and can republish when membership changes. Playlist ordering must be explicit
and deterministic, with optional shuffle/randomization as a user choice.
Smart rules are stored with the playlist and regenerate atomically in artist/title order by
default. Generated static and smart playlists can instead use a saved shuffle seed; regeneration
keeps the same shuffled order for unchanged membership. The scheduler checks daily or weekly
rules every 15 minutes; users can also regenerate manually.
When regeneration changes membership, Vidarr republishes only to libraries where the smart
playlist was previously pushed. A failed publish is recorded in playlist sync status and retried
at the next regeneration.
Partially published smart playlists are also retried at the next regeneration, even when local
membership has not changed.
Replacing a previously published playlist requires every selected item to be available and matched
in that playback library; otherwise Vidarr preserves the last published copy and records the
failed push for review or retry.
Plex sections without reliable artist metadata use title matching only when exactly one item in
the selected library has that title; duplicate titles require review rather than an arbitrary pick.
Existing static playlists and their item order are preserved by the additive migration.

## Current alignment priorities

1. Use the observed release/recording set as supporting evidence for ambiguous artist matches.
2. Inventory existing music videos from Plex and Jellyfin and reconcile them with IMVDb official
   records while preserving supplementary inventory.
3. Generalize authoritative sources to support IMVDb-provided YouTube and Vimeo links.
4. Map imports to connector libraries and trigger/reconcile media-server refreshes.
5. Expand static playlist filters and add persisted smart-playlist rules.
6. Validate the Plex connector end to end against a real Plex server.
