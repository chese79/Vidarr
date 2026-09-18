# Vidarr development instructions

Read `docs/product-vision.md` before changing product behavior or the data model. It defines the
canonical artist catalog, media-server integration, download-source priority, and playlist goals.

## Required workflow

- Preserve user data and backward compatibility. Database changes require a Prisma migration.
- Add or update automated tests for behavior changes.
- Run the relevant build and tests before committing. The supported runtime is Node 22; use the
  Docker build/test environment when the host Node version is incompatible.
- Keep commits focused and use conventional commit subjects such as `feat:`, `fix:`, `docs:`, or
  `test:`.
- Document every commit. Update `CHANGELOG.md` in the same commit for user-visible behavior,
  deployment, configuration, compatibility, or operational changes.
- Update the relevant long-form documentation in the same commit when architecture, data flow,
  setup, deployment, or product behavior changes. Do not rely on a commit message or chat history
  as the only documentation.
- Commit messages should state the outcome. The commit body should record important design choices
  and the verification performed when those details are not obvious from the subject.

## Deployment safety

- Do not modify or remove Docker configuration volumes or media files as part of source updates.
- Rebuild and recreate only the Vidarr service unless the requested change explicitly involves a
  different service.
- Never commit credentials, API keys, passwords, databases, downloaded media, or local `.env`
  files.

