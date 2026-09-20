---
name: github-feature-spec
description: Turn a feature discussion, product idea, or informal coding request into a dated, implementation-ready specification suitable for repository documentation and a GitHub issue. Use when requirements should be defined, preserved, handed to another engineer or agent, or published as a GitHub work item. Do not use for implementing the feature itself.
---

# GitHub Feature Spec

Create a durable contract between product intent and implementation without inventing decisions
that materially expand scope.

## Workflow

1. Inspect repository guidance, product documentation, current behavior, and terminology.
2. Separate domain truth, workflows, UI, API/data, migration, safety, performance, accessibility,
   testing, acceptance criteria, and exclusions.
3. Reconcile contradictions in favor of the user's latest statement and expose unresolved decisions.
4. Write observable outcomes; prescribe implementation only to protect an invariant or constraint.
5. Read [references/spec-structure.md](references/spec-structure.md) and omit irrelevant sections.
6. Persist requests in the repository's established location or
   `docs/requests/YYYY-MM-DD-<slug>.md`, using the user's exact title.
7. Only when explicitly authorized, commit/push per repository rules and create a GitHub issue with
   the exact title and specification body. Drafting does not authorize external writes.
8. Integrate newer remote work safely; never force-push for this workflow.
9. Report the document, commit, issue URL, and working-tree state.

## Quality bar

- Make the result sufficient for an implementer with no chat context.
- Define terms, defaults, state transitions, bulk semantics, failures, and data preservation.
- Distinguish sources of truth from acquisition, display, cache, or integration sources.
- Include verifiable acceptance criteria and bounded open questions.
- Do not implement the feature unless separately requested.
