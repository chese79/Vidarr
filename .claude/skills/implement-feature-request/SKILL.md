---
name: implement-feature-request
description: Use when the user asks to implement, build, or work on a feature/request document — especially one under docs/requests/*.md, but also any standalone written brief (a spec, a request doc, a set of requirements) they point at or paste in. Covers reading the request, confirming shared understanding before coding, and closing the loop with docs/tests once work lands.
---

# Implement a feature request

Vidarr's owner reads code but isn't a professional developer, and has said directly that they want
results delivered efficiently rather than a long technical back-and-forth. This skill exists so that
every feature-request implementation follows the same shape: understand, echo back, size up, build,
verify, document — without skipping the "make sure we agree on what this means" step, since a
misunderstood brief wastes far more of the owner's time than a short plain-language summary would.

## Steps

1. **Read the full request document first**, not just the part that prompted the current message. If
   it lives under `docs/requests/`, also skim `docs/product-vision.md` and `CHANGELOG.md`'s
   `Unreleased` section for context on what's already shipped versus still open.

2. **Echo the request back before doing anything else** — in plain language, no code, no file paths,
   organized by what the person would actually notice changing (screens, buttons, behavior), not by
   internal architecture. This is not optional and not a summary to skip when the request "seems
   clear": it's the cheapest possible checkpoint against building the wrong thing, and it's how the
   owner (who reads code but doesn't want to parse a technical spec back into meaning) confirms scope
   before any work starts. Keep it scannable — grouped bullets, not a wall of prose.

3. **Size up the request honestly.** If it's small (a few files, one clear approach), say so and move
   straight to building it. If it's large — multiple subsystems, several plausible approaches, real
   architectural decisions — say that plainly too, and default to breaking it into phases rather than
   attempting all of it in one pass. A phased first delivery the owner can actually see and react to
   beats a bigger one they can't evaluate until the end. Use Claude Code's plan mode for anything at
   this scale so the phasing itself gets reviewed before code is written, not after.

4. **Ground the plan in the real codebase, not assumptions.** Before proposing what's new work, check
   what already exists that can be reused or extended — existing routes, pipeline functions, UI
   patterns, CSS classes. Delegate this exploration when the surface area is large enough to warrant
   it. Name what's reused and what's genuinely new in the plan; don't propose rebuilding something
   that already works.

5. **Build, verify, then document.** Once a phase is approved and implemented: run the full build and
   test suite, add tests for the actual behavior that changed (not just a happy path — see this
   project's standing rule in `CLAUDE.md` for anything touching auth/security specifically), verify
   UI changes live in a browser rather than trusting the build alone, and update `CHANGELOG.md` plus
   any long-form docs the change affects, per `AGENTS.md`'s standing workflow rules.

6. **Name what's deferred.** If the original request had parts not built in this pass, say so
   explicitly — in the plan and again in the final summary — rather than letting them quietly drop.
   A visible "not done yet, and here's why" is what lets the owner decide whether to prioritize it
   next, instead of discovering the gap later.
