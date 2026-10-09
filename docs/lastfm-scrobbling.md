# Last.fm playback integration

The browser uses authenticated `/api/v1/lastfm` routes to inspect status, enable/disable or unlink
the account. `POST /lastfm/link` obtains a one-hour request token server-side and returns only
the Last.fm authorization URL. After human authorization, `POST /lastfm/link/complete` exchanges
the stored token for a session. Both steps require Vidarr's API key. There is no unauthenticated
callback or caller-supplied token, and session keys/shared secrets are omitted from API responses.

The existing recommendation-provider `clientSecret` field stores the Last.fm shared secret;
recommendations still require only `apiKey`. Their `enabled` flag remains independent of
`LastFmAccount.scrobblingEnabled`. The additive `20261008170000_lastfm_scrobbling` migration adds
`LastFmAccount` and `LastFmPlayback` tables without changing user inventory. Config database
backups include these credentials and must be protected like existing connector credentials.

Jellyfin reads `/Sessions`, uses `NowPlayingItem`/`PlayState`, and enumerates `/Items` under the
selected `ParentId` (paged, cached for one minute during active playback) to verify membership.
Its virtual library ID may be absent from physical item ancestors, and adding an `Ids` filter
bypasses the parent scope; neither shortcut is used. Plex reads `/status/sessions`, filters by
`librarySectionID`, and uses `Session.id`, `viewOffset`, `duration` and `Player.state`. No user
filter is applied: the requested scope is all users in these selected libraries. Provider requests
use existing connector authentication and timeout handling. Subsonic is unsupported.

Every 15 seconds the scheduler serializes observation and delivery with account changes. Each
play records connector, library, session, external item, identity, UTC start, last position,
listened time and submission state. Credit is bounded by both wall time and forward position
progress; paused/buffering snapshots, jumps exceeding elapsed time by more than three seconds,
and gaps over 45 seconds earn zero. A disappeared session or changed item starts a fresh play.
Restarting a completed track near zero also starts a fresh play. Polling cannot reconstruct brief
plays or unobserved endpoints and never reads historical counters for scrobbling.

Confirmed catalog matches take priority over structured server artist/title metadata. Fuzzy
suggestions and filename inference are not used. Duration must exceed 30 seconds; the threshold
is `min(duration / 2, 240)` observed seconds. Now-playing is ephemeral and separate from the
durable submission state. Each play crosses the threshold once and is stored as `pending` before
delivery. Sent and ignored plays are never resent by subsequent polls.

HTTPS POST requests are signed with UTF-8, ASCII-sorted parameter names plus the shared secret,
excluding `format`, `callback` and `api_sig` from the MD5 input. Responses are checked for API
errors even on HTTP 200, and scrobble accepted/ignored counts are inspected. Raw provider error
bodies, URLs and fetch exceptions are never logged or returned. Transient transport/HTTP failures,
API codes 11/16 and rate limits (29) back off from 30 seconds to one hour. Pending plays are sent
oldest first, up to 50 per poll, with their original timestamp; no remote exactly-once guarantee
is assumed after an ambiguous network failure. Permanent failures are retained for diagnosis.
Invalid sessions disable sends and require reauthorization. Other credential errors disable sends.

Account changes, credential rotation, disable and unlink discard old observation/queue records.
Removed/disabled connectors and changed selected libraries discard their old queues. Inactive
non-pending records expire after 30 days; pending records remain until resolved or discarded.
The serialization lock assumes one Vidarr process per config database, matching deployment.

References: [Last.fm authentication](https://www.last.fm/api/authspec),
[Last.fm scrobbling](https://www.last.fm/api/scrobbling),
[Jellyfin session DTO](https://typescript-sdk.jellyfin.org/interfaces/generated-client.SessionInfoDto.html),
[Plex server API](https://developer.plex.tv/pms/).

See [user setup](user-guide.md#lastfm-account-linking-and-scrobbling) for the authorization flow.
