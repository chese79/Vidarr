---
name: implement-feature-spec
description: Consume a dated feature specification or GitHub coding request and implement it end to end with requirement traceability, safe migrations, tests, documentation, and verification. Use when the user asks to build or code a tracked feature request. Do not use merely to draft, review, or publish requirements.
---

# Implement Feature Spec

Treat the tracked request as a product contract, not a superficial checklist.

## Before implementation

1. Read repository instructions, the entire specification, and required linked product documents.
2. Inspect current code, schema, tests, and relevant history; verify the spec's assumptions.
3. Map acceptance criteria to code and verification using
   [references/implementation-checklist.md](references/implementation-checklist.md).
4. Ask only about conflicts, unsafe migrations, or decisions the repository cannot resolve.
5. An issue does not authorize publishing, deployment, closure, or other external mutation.

## Implementation

- Implement vertical behavior across domain, persistence, backend, frontend, and integrations.
- Preserve data and compatibility with safe migrations for populated databases.
- Keep provenance, availability, ownership, monitoring, and progress as distinct states.
- Make synchronization repeatable and safe under transient or partial provider failures.
- Bound large-library paths with server filtering, pagination, lazy loading, batching, indexes, and
  no avoidable N+1 queries.
- Follow repository conventions for commits, documentation, changelog, generated code, and runtime.

## Verification and handoff

1. Test changed behavior and invariants, including migrations and failures when relevant.
2. Run focused checks, required suites, and production builds.
3. Review every acceptance criterion and explicitly report deferred work.
4. When authorized to publish, reference the request and report verification and operational impact.
5. Close issues only when complete; deploy only when asked and verify health plus migrations.

Lead the final report with usable outcomes, verification, operational impact, traceability, and open
items.
