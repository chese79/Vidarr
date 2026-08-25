# Notice

vidarr is licensed under the GNU Affero General Public License v3.0 or later (see `LICENSE`).

Its domain model, provider abstractions (indexers, download clients), naming/quality conventions,
and some ported logic (release-title quality parsing, naming-token substitution, Torznab/Newznab
client handling) are adapted from or inspired by the following GPL-3.0-licensed projects:

- [Sonarr](https://github.com/Sonarr/Sonarr)
- [Radarr](https://github.com/Radarr/Radarr)
- [Lidarr](https://github.com/Lidarr/Lidarr)

Where a specific file contains logic ported or closely adapted from one of these projects, it
carries a comment noting the source. vidarr is an independent implementation for a different media
type (music videos) and is not affiliated with or endorsed by the Sonarr, Radarr, or Lidarr teams.

vidarr itself is licensed AGPL-3.0-or-later, a stricter license than the GPL-3.0 these projects use
(AGPL adds a network-use clause: if you run a modified vidarr as a network service, you must offer
its source to users of that service, not just to people who receive a distributed copy). GPL-3.0
code can generally be incorporated into an AGPL-3.0-or-later work, but this repository has not had
that compatibility independently confirmed by counsel — treat this note as a pointer to check, not
as legal advice.
