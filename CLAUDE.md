# vidarr — project instructions

## Git / GitHub

- Every commit pushed to GitHub must have a clear, descriptive commit message: what changed and *why*, not just what files touched. Write it so someone reading `git log` later understands the reasoning without re-reading the diff.
- Non-obvious code changes need inline comments explaining the *why* (a hidden constraint, a workaround, a subtle invariant) — not restating what the code already says.
- Every successful build on `main` publishes a public Docker image automatically — see `.github/workflows/docker-publish.yml`. This isn't something to run by hand; it's a standing CI rule. The image lives at `ghcr.io/<owner>/vidarr` (`:latest` and `:<commit-sha>` tags), and its GHCR package visibility must stay **public** — GHCR defaults a brand-new package to private on first publish, so that needs setting explicitly once, not assumed.
