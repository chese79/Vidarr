# Slim and Full builds

Requested: 2026-10-18. Status: documented product direction only; do not implement yet.

## Scope

Vidarr will offer multiple editions long term. The initial two editions are:

Clarified 2026-10-19: keep install components separate. Slim and Full are installation presets
over the same application, with additional features selectable as optional components. Do not
maintain separate application forks or require refactoring application code when choosing a
different preset. Optional components must declare their dependencies. Full selects every
available component; Slim excludes the two video validation components and FFmpeg. Custom
installation can select additional features with their required dependencies. Component packaging
is future work; the current Full local deployment uses the existing complete application.

| Edition | Required scope |
| --- | --- |
| Slim | Full application functionality except video validation types 1 and 2; no FFmpeg dependency. |
| Full | Everything, including both video validation types and the media tooling needed for them. |

For this requirement, type 1 means **Check video file** (video-stream/file probing),
and type 2 means **Check video motion** (moving-video versus static-content inspection).
These are checks, not the existing source categories such as initial import, canonical
download or additional download. Slim omits both checks across categories and music-video/Live
paths; it must not retain a hidden sampled-motion equivalent of the omitted checks.
Full retains the existing configurable validation policies and defaults; “everything” does
not mean forcing every optional check on for every acquisition.

Slim is not a reduced catalog, acquisition, connector, playlist or Live edition. Full functionality
apart from these two checks remains the requirement. Omitting FFmpeg must not silently remove
other features or claim an inspection succeeded when it did not run.

## Workflow and compatibility requirements for future implementation

Slim intentionally omits the two physical video checks above. Preserve artist identity,
source/content metadata eligibility, uncertain-content review, ownership/ignored checks,
acquisition eligibility, import/registration, exact media-server delivery confirmation and
playlist review/publication. Import success alone must not become server-confirmed delivery.
When omitted physical inspection leaves content eligibility uncertain, preserve review rather
than inventing a successful visual inspection or automatically admitting an uncertain source.

The UI/API must distinguish checks unavailable in Slim from checks disabled by policy in Full,
and from checks that actually passed. Switching editions must preserve catalog identities,
settings (including Full validation choices), queue/staging, review decisions, playlists,
server bindings and user media. Any necessary database changes require Prisma migrations.

## Dependencies to resolve before building

Current FFmpeg-family use extends beyond these checks: discovery sample extraction, yt-dlp
merging/remuxing and ffprobe-based embedded metadata scanning. Simply removing binaries or
turning off the two settings does not implement Slim. Future design must account for these
call sites and provide a compatible path without silently narrowing the requested functionality.
Clarify whether a standalone ffprobe dependency is acceptable; the requested exclusion is
“no ffmpeg,” and a separate probing dependency has not been approved or ruled out.

Image/tag names, the specific component packaging mechanism, edition detection and dependency
alternatives are not decided by this document. Do not publish images from this request.

## Acceptance criteria for future implementation

1. Slim runs without FFmpeg and exposes full functionality except validation types 1 and 2.
2. Neither omitted check is executed or reported as passed in Slim, including discovery samples,
   existing-file registration and Live acquisition/import paths.
3. Full retains all functionality and configurable file/motion checks.
4. Shared required workflow stages and edition-switch data preservation are verified.
5. Non-validation media-tool dependencies have explicit, tested solutions before Slim ships;
   unresolved dependencies are not treated as permission to reduce functionality.

## Explicit exclusions from this request

The edition request authorizes documentation only, not component implementation. On 2026-10-19
the user separately authorized continuing local deployment with the existing Full application;
that does not authorize implementing optional install components or changing media.
The user replaced the undeployed MTV pre-rendered component with a [native playback overlay](../mtv-overlay.md)
on 2026-10-19 and separately selected both Roku and web implementation. Its client-side drawing
does not require FFmpeg or video copies; those two optional client components install independently
of Vidarr. This edition plan alone does not authorize implementing the general Slim/Full component
installer.
