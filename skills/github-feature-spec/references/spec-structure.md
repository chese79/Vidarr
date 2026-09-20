# Feature specification structure

Use only sections that materially help the implementer:

1. Exact title and ISO request date.
2. Objective and problem.
3. Domain model, source of truth, provenance, and states.
4. Workflows, controls, defaults, filters, actions, and errors.
5. Integration synchronization, reconciliation, confidence, and transient failures.
6. UI hierarchy, navigation, loading, empty, and responsive states.
7. API/data behavior, idempotence, migrations, and compatibility.
8. Performance scale, accessibility, security, and privacy.
9. Data safety, deletion boundaries, stale data, and recovery.
10. Behavioral tests and invariants.
11. Numbered, externally verifiable acceptance criteria.
12. Explicitly excluded nearby behavior.
13. Decisions that cannot safely be inferred.

Prefer precise “must,” “may,” and “must not” statements. Avoid dictating architecture unless needed
to preserve a requirement.
