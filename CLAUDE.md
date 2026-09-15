# vidarr — project instructions

## Git / GitHub

- Every commit pushed to GitHub must have a clear, descriptive commit message: what changed and *why*, not just what files touched. Write it so someone reading `git log` later understands the reasoning without re-reading the diff.
- Non-obvious code changes need inline comments explaining the *why* (a hidden constraint, a workaround, a subtle invariant) — not restating what the code already says.
- Every successful build on `main` publishes a public Docker image automatically — see `.github/workflows/docker-publish.yml`. This isn't something to run by hand; it's a standing CI rule. The image lives at `ghcr.io/<owner>/vidarr` (`:latest` and `:<commit-sha>` tags), and its GHCR package visibility must stay **public** — GHCR defaults a brand-new package to private on first publish, so that needs setting explicitly once, not assumed.

## Security-sensitive changes

- Any change touching authentication, authorization, secret generation/reveal, or similar security-relevant logic must ship with test coverage for the actual security property being protected — not just a happy-path test. Example: the API-key bootstrap-reveal feature (`apps/server/src/api/setup.ts`) has explicit tests in `apps/server/test/api/setup.test.ts` for each property that matters — it reveals the key before first use, stops permanently after first successful auth, expires on its own after a time window even if never used, and never checks the request's own auth header. A test that only covers "the happy path works" isn't enough here; write one per invariant that would be bad to silently break.
