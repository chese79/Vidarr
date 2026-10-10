# Discover review and playlist creation

The main menu starts with Library, Playlists, Discover, Artist Review and Video Review.
Artist Review retains `/match-review` for existing links. All visible UI borders use `#FFFFC5`;
thumbnail and gradient backgrounds retain a separate dark surface token.

Artist Review lists artists with the most suggested matches first. Sorting applies before paging
and within search results, with name and ID breaking ties. Counts include all suggested matches;
the expandable preview continues to show only the three highest-scoring candidates.

## Library filters
Library's **Has missing videos** filter uses ownership across the preserved videos displayed in
expanded artist rows, including catalog-review entries. **Min local videos** counts only records
with a local file, including supplementary inventory; server-only availability does not count.
Both filters apply before pagination and may be combined. The old API `minKnownVideos` parameter
remains supported, while old Library URLs with that threshold open the renamed local filter.
Summary queries group enabled, available and confirmed server matches and active downloads before
joining the video inventory. Multiple server copies or queue records cannot multiply video counts;
play counts prefer a known local value and otherwise use the highest confirmed server value.

## Discover


For the artist chosen in **Existing artists**, review the genre checkboxes, refresh them from sources
or add a genre, then click **Confirm Genre & Add All**. This saves the selected genres as user
overrides, collects the artist's sources, enables artist monitoring and monitors every catalog video.
It also re-enables ignored catalog videos, reflecting the explicit request to acquire the whole catalog.
Only missing acquisition targets are searched/downloaded; owned videos, pending imports, active
downloads and inventory-only records are skipped. Individual failures remain monitored for retry and
are reported on Discover. Unreviewed source candidates still require the normal Video Review decision.
Returning from artist review preserves the chosen artist so this action is available there.

Select an existing artist from the dropdown to review it, or search MusicBrainz by free text.
Choose **Add to Library & Review** on the desired identity. Additions reuse the canonical MBID,
preserve the artist's configuration, record discovery provenance and remain unmonitored by default.
The source collector checks IMVDb, linked YouTube/YouTube Music channels and local video roots.
This collection runs in the background; the review page polls for the resulting videos.
Configured indexers and acquisition providers are searched when you use **Search Selected**.
Adding an artist does not trigger downloads of its whole catalog.

**Add New Artist**, the blue button beside Refresh Recommendations, requires a unique matching
MusicBrainz name or alias. Unmatched names, ambiguous names and provider failures are explained
without creating an artist. For ambiguous names, use MusicBrainz search and choose the correct
identity. Validation is cached for one minute, with at most 100 names retained, and the server
independently enforces it at addition. Older clients cannot bypass validation with an unverified override.

Library's **Add Artist** form also searches MusicBrainz and requires selection of a returned identity.
The Add manually option is removed. Last.fm and IMVDb remain metadata/video sources after canonical
identity confirmation; they do not validate artist additions. Existing observations remain preserved
for Artist Review. Confirmed additions collect all video sources in the background.

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
