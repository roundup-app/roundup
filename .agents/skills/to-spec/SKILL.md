---
name: to-spec
description: Turn an observed gap into a bounded scenario and a GitHub work Issue.
---

Read `.agents/data/work.md`. Search existing Issues, PRs and scenario headings first. Reuse an owner when one covers the gap.

Use the current conversation and accepted product/design documents to specify the outcome, ownership, observer and regressions. Keep acceptance in the scenario; publish the work order as an Issue with native blocking dependencies and an immutable Key. Add its native dependencies when you file it: an open Issue is queued at once (L34). Never create a scenario Work table. A consequential product choice absent from the accepted documents stays a question on the Issue; ordinary engineering choices do not go to the user.

Pick a new scenario id after `git fetch`, not when the run starts: the next free id of its prefix across `origin/main` and every open PR's added scenario headings. Immediately before the push, run `loop/rules.sh scenario-ids` on your branch merged with `origin/main` (L97).
