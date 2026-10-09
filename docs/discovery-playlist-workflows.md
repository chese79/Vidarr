# Discover review and playlist creation

The main menu starts with Library, Playlists, Discover, Artist Review and Video Review.
Artist Review retains `/match-review` for existing links. All visible UI borders use `#FFFFC5`;
thumbnail and gradient backgrounds retain a separate dark surface token.

## Discover

Select an existing artist from the dropdown to review it, or search MusicBrainz by free text.
Choose **Add to Library & Review** on the desired identity. Additions reuse the canonical MBID,
preserve the artist's configuration, record discovery provenance and remain unmonitored by default.
The source collector checks IMVDb, linked YouTube/YouTube Music channels and local video roots.
This collection runs in the background; the review page polls for the resulting videos.
Configured indexers and acquisition providers are searched when you use **Search Selected**.
Adding an artist does not trigger downloads of its whole catalog.

**Add New Artist**, the blue button beside Refresh Recommendations, accepts a name and checks
MusicBrainz, Last.fm and IMVDb. An exact normalized name match from any source validates the name.
Last.fm requires the saved application API key but does not require account linking or recommendation
enablement. IMVDb uses the configured API when available and its public artist page as a fallback.
Provider failures are reported and never treated as successful validation. Checks are cached for
one minute, with at most 100 names retained. The server independently enforces validation at addition.

If no source validates the name, the form displays a warning and an explicit **Add unverified
artist anyway** action. Only a unique MusicBrainz identity confirms a canonical Library artist.
Last.fm-only, IMVDb-only, ambiguous and unverified additions are observations requiring identity
confirmation in Artist Review. The artist page provides that confirmation workflow.

Discover stores its filters, typed searches, artist selection and checked recommendations in URL
parameters. Artist navigation carries a bounded Discover return URL and scroll position. A completed
selected search returns with its grabbed/skipped counts. Successful selected downloads return after
all submitted transfers succeed; failures retain their checked videos for retry. **Back to Discover**
also returns without discarding the original Discover context.

## Playlists

The primary creator starts at 20 videos and Shuffle. The count sits next to the name, with **Only
add unwatched videos** nearby. Select a playback library and use **Use as default playback library**
to persist it for future creation. With no usable saved default, the first enabled Plex/Jellyfin
video connector is selected. Existing playlist bindings are never changed by a default setting.
An empty manual playlist remains available in a separate expandable section.

The generator draws from the chosen library's confirmed, available inventory. With no active filters,
all eligible videos can participate. Each filter has an activation control; disabled filters are
omitted even if their input still contains a value. Genre and Director have catalog-based autocomplete.
Director is the last filter. The Quality picker is removed; older stored Quality criteria remain
supported and preserved for compatibility.

Unwatched is a mandatory constraint even when other filters use ANY. It requires known zero counts
in the selected library, rejects positive counts and does not interpret unknown counts as zero.
An unbound playlist considers known local and enabled server counts. Inventory/play-count sync must
run before server play counts can be used reliably.

The video limit is applied after the saved shuffle ordering. Smart regeneration retains both the
limit and seed, so unchanged membership keeps the same chosen videos and order. Existing unlimited
playlists display Unlimited and retain their behavior. Smart rules edited to remove all filters
can include the whole eligible inventory, subject to the saved limit.

Static playlists retain manually edited contents unless **Replace videos from filters** is checked.
That action replaces the snapshot immediately and republishes changed contents to existing destinations.
It does not turn the snapshot into a scheduled smart playlist. Ordinary renames preserve its order.

Migration `20261009040000_playlist_defaults` adds nullable `Playlist.maxVideos` and
`Settings.defaultPlaybackConnectorId`. Existing limits remain null. Legacy empty smart rules, which
previously matched nothing, become an explicit impossible video-ID filter to preserve that result.
Removing that filter deliberately adopts the new all-eligible behavior.
