Recorded from the pinned `claude` 2.1.300 (`pnpm-lock.yaml`), started in a pty against aimock with
`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 claude --agent-id worker@t1 --agent-name worker --team-name t1`
and `teams/t1/config.json` naming `team-lead` as the lead.

- The inbox of a name is `<config>/teams/<team>/inboxes/<name>.json`, a JSON list of entries.
- `lead-inbox.json`: what the teammate wrote to `team-lead.json` (a permission request, then an
  idle notification after each turn), as `claude` wrote it.
- `permission-response.json`: the entry written to `worker.json` that let the Bash call run.
- `note.json`: the entry written to `worker.json` that `claude` took up.
- `transcript.jsonl`: the transcript line `claude` recorded for `note.json` (a `user` entry whose
  text is a `<teammate-message>`); `claude` empties `worker.json` of the entries it has taken.

Re-record when `pnpm-lock.yaml` moves `@anthropic-ai/claude-code`.
