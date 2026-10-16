---
name: to-spec
description: Turn an observed gap into a bounded scenario and a GitHub work Issue.
---

Read `.agents/data/work.md`. Search existing Issues, PRs and scenario headings first. Reuse an owner when one covers the gap.

Before writing a scenario for new machinery, ask "which library already does this?" Research at least two candidates and record the selection or specific rejection evidence required by rule 9.

Use the current conversation and accepted product/design documents to specify the outcome, ownership, observer and regressions. Keep acceptance in the scenario; publish the work order as an Issue with native blocking dependencies and an immutable Key. Add its native dependencies when you file it: an open Issue is queued at once (L34). Never create a scenario Work table. A consequential product choice absent from the accepted documents stays a question on the Issue; ordinary engineering choices do not go to the user.

Name each new scenario `<area letter><Issue number><lowercase letter>`, with the number of the work Issue you file or specify for and letters `a`, `b`, … in order: Issue #2176 gives `U2176a`, `U2176b`. The Issue number is unique, so two concurrent specs never claim one id; never count on from the highest existing id. Existing ids keep their names. Immediately before the push, run `loop/rules.sh scenario-ids` on your branch merged with `origin/main` (L97).
