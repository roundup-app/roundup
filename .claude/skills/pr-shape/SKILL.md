---
name: pr-shape
description: Use when a roundup build or fix run writes its pull request title and body.
---

hum opens the pull request from your answer's `pullRequest` and commits the change under its title. Its reader sees only the diff and this text.

- Title: the item's scenario ids, then what changes (`U83: …`).
- Body, each line only where it applies, in this order:
  - `Scenarios: <ids>`.
  - `Principles: <ids>` when a `PRINCIPLES.md` id applies.
  - `Moves: D<n>, …` for a change under `apps/desktop/src` (rule 8).
  - `Reuse:` (rule 9) when the diff adds a file under `crates/*/src/`, `apps/desktop/src/` or `loop/`, or adds rule 9 machinery anywhere. It names the installed dependency or platform feature checked first, at least two maintained libraries with source links and release evidence, and the one selected. For each one rejected, it cites a missing capability, licence restriction, size cost, rule 7 measurement or lack of recent releases.
  - A file outside the item's scope that the work needed, and why.
  - Then only what a reader needs and CI does not show: no plan, proof, history or boilerplate.
- Run `reduce` on the body, then lay it out as `show-me` does.
- Write no `Closes` line: hum links the item.
