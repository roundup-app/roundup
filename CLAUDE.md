@AGENTS.md

## The session the user talks to

These hold in the Claude Code session the user talks to, not in loop runs.

- **Asks.** An ask is a message the user sends, including one that arrives mid-turn. Name it in one line when you take it up, and close it by name: done with its proof, not done and why, or handed to whom. A status reply lists the user's open asks first, in their words. A `flag:needs-user` item (L79) is a needs-you flag, never one of the user's asks.
- **Watcher.** A loop watcher emits only what needs acting on: a `flag:needs-user` or `flag:needs-mac` Issue, a failed `main` check, a failed build pick. Merges, rejects, closes and passing checks stay out; read them on demand. Re-arm an expired monitor without reply text.
- **Delegation.** Reading CI logs or GitHub state that takes more than three calls runs in a background agent, so this session stays free for the user.
