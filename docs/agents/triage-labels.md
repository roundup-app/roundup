# Triage Labels

The skills speak in terms of five canonical triage roles. Work items are roundup Todos, which have no labels (`docs/agents/issue-tracker.md`), so each role maps to a Todo action.

| Label in mattpocock/skills | roundup Todo | Meaning |
| --- | --- | --- |
| `needs-triage` | _none_ | A Todo assigned to hum's Agent is already queued |
| `needs-info` | a Todo comment | Ask with `rup todo comment` |
| `ready-for-agent` | assigned to hum's Agent | hum builds it |
| `ready-for-human` | unassigned | No agent takes it |
| `wontfix` | deleted | Will not be actioned |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), take the Todo action from this table; for _none_, do nothing.
