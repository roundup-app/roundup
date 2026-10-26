# U4277c critic repair

1512×950, dark, isolated headless Chromium.

| Finding | Repair |
|---|---|
| Import failure clips and overlaps metadata | Conversation rows grow with their titles. The checkbox spans the row; only the title reserves the Copy gutter, leaving metadata and its reserved failure line enough width for the whole cause and recovery. |
| Empty Terminal state runs into actions | Actions align together at the trailing edge with `--space-3` leading separation. |
| Hidden Terminals are called empty | Main's U4274 primary navigation is retained: no bar with zero Project Terminals, no empty claim when selection hides existing Terminals, no retired visibility toggle. |

Behavior: 17 primary-navigation tests and 20 Import tests pass; three Import rendered audits remain opt-in skips. The failed-row test retains its original assertion and DOM ownership. No test was removed. The new hidden-Terminal test covers the uncovered status regression; U4274c retains the empty/populated lifecycle proofs.

The broad related run was started separately; only its completed result can count as a pass. CI judges the push.

All six final rendered observers pass. Thirteen paired screens pass D1–D14 (and D16 where present), with no passing Check regressed against the rejected head or recorded main baseline. `just ready` passed with exit 0. PNGs and videos remain uncommitted.
