# Jellyfin MTV subtitle proof of concept

Independent experiment, **not a production plugin**. The old native client prototype remains
archived. This component generates timed ASS subtitles and tests the existing Jellyfin burn-in
pipeline with synthetic media. It never edits Vidarr's schema. The separately authorized
production test below adds only a dedicated test library/playlist; existing libraries and user
preferences are preserved.

## Verified locally — 2026-10-24

- Jellyfin 12.3.0, using the installed Windows runtime in a separate instance on port 18096.
- Two 24-second synthetic 720p H.264/AAC videos, local music-video NFOs and ASS sidecars.
- Eight Node 22 generator tests pass: timing, short clips, invalid duration, missing metadata,
  item year, directors, literal text escaping and bottom-left ASS positioning.
- A Roku-shaped subtitle profile (VTT/SRT/TTML/SUB external; not a captured device profile)
  receives ASS burn-in through HLS **with Direct Play/Direct Stream allowed**. Jellyfin reports
  `SubtitleCodecNotSupported`. Two streams each return eight playable segments.
- With the lab user's subtitle mode Always and English preference, the default track is selected.
- Rendered HLS frames show the block at 1s and 20s, with no block at 10s.
- A separate 20s seek request downloads only the late 18–21s segment. Its frame at source time
  20s still shows the overlay. Transport timestamps have an offset; the fixture's visible
  source clock is used for inspection. A sampled software-transcode log ends at 2.28x speed;
  this is not a capacity claim for real music videos, HDR or multiple simultaneous sessions.
- With subtitles set to None, Jellyfin selects no track and allows Direct Play: **the overlay
  does not automatically activate**. A plugin override has not been established.

**Pending:** physical Roku 3.2.4 / Streaming Stick 3810X playback, playlist auto-advance, pause/resume,
client subtitle toggles, device seeking and web-player confirmation. No remote playback command
was sent to the production Roku session. No compiled plugin is installed anywhere.

## Reproduce (PowerShell 7, Node 22, existing Jellyfin Windows runtime)

Run these commands from the repository root. The standalone scripts also run on newer Node,
but verification uses the supported Node 22 container.

```powershell
.\integrations\jellyfin-mtv-poc\start-lab.ps1
.\integrations\jellyfin-mtv-poc\build-fixtures.ps1
node integrations/jellyfin-mtv-poc/lab-api.mjs setup
node --test integrations/jellyfin-mtv-poc/overlay.test.mjs
node integrations/jellyfin-mtv-poc/probe-playback.mjs
node integrations/jellyfin-mtv-poc/probe-seek.mjs
node integrations/jellyfin-mtv-poc/probe-selection.mjs
```

`start-lab.ps1` launches the installed runtime hidden with **all** data/config/cache/log directories
inside `.lab`. It refuses an occupied port; it does not stop/reconfigure any installed service.
Remote access and UPnP are disabled in the lab network configuration. LAN Roku testing still
requires host firewall access; no firewall exceptions or router rules are added by these scripts.
`lab-api.mjs` accepts only the fixed loopback lab address and binds the generated login to that
server's ID. Setup is repeatable; an unfinished wizard reuses its private generated login.
The lab library contains synthetic media only. No existing media mounts are attached.

The ignored `.lab/credentials.json` contains the temporary username/password. Other ignored lab
files include database, tokens in Jellyfin logs, caches, media and evidence. Do not commit/share
that directory. The main Docker build excludes this component's entire directory.

## Official Roku test

1. In the standard Roku Jellyfin app, add `http://192.168.0.8:18096` as another server. Keep your
   existing production server saved. Use the temporary login from `.lab/credentials.json`.
2. Open the **MTV Overlay POC** playlist in **MTV Overlay Lab** and play it.
3. Confirm text during 0–6s, none during 6–18s, and text again during 18–24s on **both** videos.
4. Pause during the intro, resume, and seek into/out of the outro; text should follow video time.
5. Confirm that the ASS track is selected. If absent, explicitly select it and record that manual
   selection was required. Turn subtitles off and confirm the overlay disappears.
6. Record device/app version, playlist auto-advance, buffering, position/style and whether the
   session reports transcoding. Return to your saved production server afterward.

If the device cannot reach the lab, record that failure. Do not treat an API probe as device proof.

Stop only this lab, retaining its files:

```powershell
.\integrations\jellyfin-mtv-poc\stop-lab.ps1
```

## Generator and scope

`node overlay.mjs metadata.json duration-seconds output.ass` creates a new file exclusively;
it never overwrites an existing subtitle. Supply a probed positive duration. JSON accepts
`artist`, `title`, `album`, `videoYear`, `director`, or corresponding Jellyfin item properties.
The year must already mean the music video's year; no album-year fallback is implemented.
Provider text is bounded and ASS control syntax is neutralized. Metadata/NFO reading and automatic
subtitle registration/generation for a real library remain future work.

The fixture layout uses six seconds at each end, white outlined text, a lower-left safe-area margin,
and artist/title/album/year/director/MTV lines. Short clips merge overlapping windows. These are
POC defaults, not a re-adoption of all requirements from the abandoned native-client design.

This experiment generates ordinary HLS transcode files in **lab** cache plus saved synthetic
evidence segments. It does not promise zero temporary storage, Direct Play with an active burned
overlay, automatic activation when subtitles are disabled, or simultaneous independent captions.
Full plugin work depends on the real-device result and a supported selection/enablement design.

## Authorized production test — 2026-10-24

The user requested deployment to the normal Jellyfin server. `http://192.168.0.8:8096` now has
a separate **MTV Overlay Test** music-video library and playlist with both synthetic clips.
Six fixture files (two MP4/ASS/NFO sets) were copied into `.lab/production-media` with matching
checksums. No original music videos or subtitle files were changed. No plugin/client build or
server restart was involved. The library registration initially requested a scan; the test folder
was also refreshed directly while a broad production scan was running. The operator script now
uses only a targeted library refresh for future creation.

Private `.lab/production-baseline.json` records the server/user identities, original six library
IDs/locations, twelve playlist IDs and user configuration. `.lab/production-report.json` records
the new test identities. Deployment checks those original libraries, playlists and preferences
before every further action, refuses reused test names pointing elsewhere, and requires
`MTV_PRODUCTION_OVERLAY_TEST=1` for creation. Credentials are read inside a read-only Vidarr
helper container and never exported to these reports. Thirteen Node 22 tests pass for generator
behavior and the production baseline/path safeguards.

The `production-control.mjs` operator supports inspect/deploy/verify/probe; it must run in the
existing Vidarr runtime with its config mounted read-only and this component at `/audit`.
`probe` requires a separate writable `/evidence` mount. It selects ASS explicitly for one
synthetic item, confirms `SubtitleMethod=Encode`, and fetches one HLS segment. This production
probe succeeded; `.lab/production-evidence/production-intro.png` visibly contains the overlay.
This is a server stream check, not physical Roku confirmation.

Use your existing Roku server and login. Open **MTV Overlay Test**, play the playlist, then
select **English ASS** in the Jellyfin app's playback subtitle controls. Roku system-wide closed
caption preferences do not select this Jellyfin media track. The user's existing subtitle mode
remains None, so selection is required. The Roku session does not support remote control; no
remote play command was sent. Physical playlist/seek/pause verification remains pending.

### Roku diagnostic follow-up

The user reported no overlay on either clip despite ASS being selected. The observed production
Roku 3.2.4 session reported `PlayMethod: DirectPlay` on Synthetic Song 1, and no new Roku burn-in
transcode was logged. The manual selection is user-reported; the session does not expose its
subtitle index. This establishes a playback-path mismatch, not a confirmed stream-index bug.
The initial API probes remain server-only evidence.

Next diagnostic: temporarily choose Settings → Playback → Force Transcoding → All Playable Media
→ Force Transcode (Remux Disabled) in the Roku Jellyfin app, enable Burn in subtitle when
transcoding, and restart the test with ASS selected. Restore Play Normally afterward. This is
a temporary device test, not the production overlay activation design. Its failed outcome is recorded below.
Official source for the installed version exposes a Direct Play branch before the burn-in branch:
[Roku 3.2.4 playback source](https://github.com/jellyfin/jellyfin-roku/blob/3.2.4/components/ItemGrid/LoadVideoContentTask.bs).

The forced-transcode trial also produced no overlay. Production logs confirm software HEVC/MP3
encoding with **no subtitle filter**, unlike the successful explicit-index API probe. The user
was asked to restore Play Normally; restoration is not remotely verified. The forced setting
was slower than realtime (sample logs around 0.4–0.5x), so it is not a suitable permanent fix.

An additional synthetic **Embedded ASS Diagnostic** MKV copies the original fixture's H.264/AAC
streams without re-encoding and embeds ASS at index 2, rather than external index 0. It is confined
to the existing test folder. `build-embedded.ps1` reproduces it without overwriting files;
`production-control.mjs diagnostic` refreshes/registers it and creates the separate **MTV Embedded
ASS Test** playlist once the embedded stream is discovered. `probe-embedded` checks the server
path and writes one segment to `/evidence/production-embedded-intro.ts`. This isolates packaging/
selection as a hypothesis; an index-0 client bug is not proven. Physical playback remains pending.
The diagnostic is indexed and its playlist is ready. A production `probe-embedded` request
successfully burns the embedded track at index 2; the saved intro frame visibly contains the
block. A playback-info request resolved stream metadata after the background refresh had only
created a placeholder item. The user was asked to test this separate playlist with Play Normally
restored; that physical result is still pending. No production preferences were changed by the
operator script, and all thirteen focused Node 22 tests still pass.

The user subsequently reported **no titles on the embedded diagnostic either**. A later log
inspection found no new Roku burn-in transcode for that item; the successful embedded FFmpeg
log still corresponds to the operator's server-side probe. Therefore neither packaging variant
has passed physical Roku verification. Do not present this POC as a working standard-Roku overlay
or proceed to full plugin deployment based on the API probes alone.

Next proposed diagnostic: with explicit user approval, temporarily change only the production
user's SubtitleMode and language preference to Always/English, play the test from the beginning,
then restore those saved fields. The baseline already contains the original values. This tests
server preselection rather than in-play client selection; approval is pending and no preference
change had been made at the time of that proposal. Restoration must preserve any unrelated
settings changed during the test.

The user approved the temporary test. `selection-test.mjs run` saves the current two fields in
ignored evidence **before** changing anything, applies Always/English, verifies API preselection,
observes only the relevant Roku session, and restores after five minutes in `finally`. A detached
short-lived helper container keeps rollback independent of the chat turn. Creating an ignored
`restore-now` file in the evidence mount requests early restoration; `selection-test.mjs restore`
can recover from the saved state if needed. State records distinguish active from verified restored.
Restoration merges only the two controlled fields into fresh configuration, preserving unrelated
changes; a conflicting independent change to those fields requires review. Four unit tests cover
restoration and conflict behavior (17 focused POC tests in total).

During this approved test, API requests with **no explicit subtitle index** automatically select
external ASS index 0 and embedded ASS index 2, both with Direct Play false and burn-in offered.
The user was asked to stop the current queue and reopen the embedded test without manual
subtitle selection. That physical result and the final rollback outcome must be recorded below.

### Confirmed Roku display and restored defaults

The user confirmed **Titles appear now** after reopening MTV Embedded ASS Test with the approved
Always/English defaults active. This establishes physical display on official Roku 3.2.4 / 3810X
for the embedded ASS fixture with server preselection. It does not establish that an index-0 bug
caused the earlier failures, or that every client works. Physical outro timing, pause/seek and
playlist auto-advance still need separate confirmation.

Early restoration was requested immediately after that confirmation. Saved recovery state reports
`phase: restored`; an independent production API read verified SubtitleMode **None** and the
original empty language preference. The short-lived helper exited. No permanent user-default
change was retained. The viable path is now proven for this test, but a full plugin still needs
an explicit activation policy: merely generating a subtitle does not guarantee the client selects
it, and global Always/English is not silently enabled as the product default.

Recovery: use the saved test IDs/paths to identify and remove only the test playlist/library from
Jellyfin when requested. Do not choose deletion of original media or remove any original library.
Keep fixture files and the baseline/report until recovery is checked. No automatic destructive
cleanup is included, and no production subtitle preference needs restoring because none changed.

Reference: [Jellyfin codec/subtitle behavior](https://jellyfin.org/docs/general/clients/codec-support/).
The test subtitle profile was informed by the separately pinned upstream Roku source's
`source/utils/deviceCapabilities.bs`; no archived source was modified or deployed.
