# Qualified playback

A qualified play requires half the video or four minutes of observed watching, whichever comes
first. A 3-minute video qualifies after 90 watched seconds; a 60-minute video after 4 minutes.
Vidarr observes playback sessions from enabled Jellyfin/Plex connectors with a selected video
library every 15 seconds. Only confirmed available catalog matches qualify. Pending deletion,
unmatched observations and fuzzy suggestions cannot accrue new qualified plays.

This starts new history at deployment. Jellyfin/Plex native counts remain intact and are shown
as server plays, since starts and watched thresholds cannot be converted into reliable earlier
qualified viewings. Existing minimum-play and Unwatched playlist rules keep using server history.
Qualified counts aggregate observed viewing sessions across the users exposed by each connector.
They do not require a Last.fm account and do not change Last.fm submission policy.

## Observation and recovery

Persist baseline position, playing state, runtime, last observation time and earned watching
seconds. Only continuous forward progress bounded by elapsed wall time earns credit. Paused
or buffering endpoints, seeks, duplicate snapshots and observation gaps over 45 seconds earn
nothing. First observation never assumes the earlier part of a video was watched. Qualification
is a transaction: claim an unqualified viewing and increment its video's independent counter
once. Repeated progress or webhook events cannot increment it again.

Merge overlapping connectors to the same normalized server address/library/session/user.
Conflicting canonical matches do not earn credit. Keep active state and qualified decisions
across restarts. Failure to read a server breaks continuity but preserves the viewing's prior
qualification; do not infer an ending or fabricate watching during an outage. A confirmed
session ending or item change closes the viewing. A completed video restarting near zero is
a fresh viewing. Diagnostic rows older than 30 days expire after becoming inactive, while
the counter persists. Deleting the catalog video removes its viewing rows through a foreign key.

Sampling is conservative: short unobserved tails and time while Vidarr is offline are not
credited. Starting near the end cannot fabricate a qualified play. Server address aliases are
not automatically merged; configure one address per physical server to avoid duplicate inputs.
Counts normally appear after the next observation and the UI's normal refresh.

## Optional Jellyfin playback notifications

Polling already works without changing Jellyfin. For a quicker first observation, Jellyfin's
[official Webhook plugin](https://github.com/jellyfin/jellyfin-plugin-webhook) can notify Vidarr.
The connector's **Qualified-play notifications** disclosure shows its receiver address.

1. Add a Generic destination in the plugin, using a Vidarr address reachable from Jellyfin:
   `POST http://your-vidarr:3434/api/v1/libraryconnector/CONNECTOR_ID/playback-webhook`.
2. Set the custom `X-Api-Key` header to Vidarr's API key and Content-Type to application/json.
   Keep credentials in Jellyfin configuration, outside source control and the URL.
3. Enable PlaybackStart, PlaybackProgress and PlaybackStop for music videos. Use this small
   JSON template rather than sending all item properties:

   ```json
   {"NotificationType":"{{NotificationType}}"}
   ```

The receiver requires normal Vidarr API authentication and an enabled Jellyfin connector with
a selected video library. It accepts only those three event names, with a 16 KiB body limit,
and returns 202 for a queued wakeup. Wakeups coalesce; the observer never overlaps itself.
Vidarr reads current sessions using the saved connector credentials. It does not trust incoming
item IDs, playback positions or counts to qualify anything. Start/Stop events alone therefore
cannot manufacture a completed viewing. Existing 15-second polling also handles missing events.

## Deployment

Migration `20261017010000_qualified_play_counts` adds zero-initialized counters and a bounded
session journal. No native counts or existing ownership records are altered. Back up configuration
and recreate only Vidarr with the existing media/staging mounts. This revision uses a local
image rebuild and a `[skip ci]` squash merge so public image tags remain unchanged. Do not
install plugins or restart Jellyfin as part of the local Vidarr cutover.
