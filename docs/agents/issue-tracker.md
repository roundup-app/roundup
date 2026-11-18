# Issue tracker: roundup Todos

Work items are roundup Todos in this Project. hum builds each Todo assigned to its Agent, from plan to merged pull request. GitHub Issues are not work items. Use the `rup todo` CLI, or the roundup MCP `todo_*` tools.

## Conventions

- **Create a work item**: `rup todo create "<title>" --body "<body>"`, naming its scenario ids in the body.
- **Queue it for hum**: `rup todo assign <id> --owner '<hum Agent id>'`.
- **Read one**: `rup todo get <id>` and `rup todo comments <id>`.
- **List them**: `rup todo list --json`.
- **Comment**: `rup todo comment <id> "<body>"`.
- **Order after another**: `rup todo set-blockers <id> --blockers <other id>`.
- **Finish**: `rup todo complete <id>`; hum completes the ones it merges.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

## When a skill says "publish to the issue tracker"

Create a Todo as above and assign it to hum's Agent.

## When a skill says "fetch the relevant ticket"

Run `rup todo get <id>`.
