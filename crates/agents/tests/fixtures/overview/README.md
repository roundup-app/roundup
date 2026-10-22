# Closed conversation fixtures

`2.1.296-name.jsonl` is the actual `custom-title` record written by Claude Code
2.1.296 with `--name 'Overview fixture' -p 'Reply only: observed.'` on 2026-10-18,
using an isolated temporary project and config. The id is display data only.

Window fixtures in `launch.rs::a2681b_context_limit_comes_from_reply_model` use
[Claude Code's extended-context table](https://code.claude.com/docs/en/model-config#extended-context)
and the [model overview](https://platform.claude.com/docs/en/models/overview),
read 2026-10-18. Claude Code's unsuffixed Opus/Sonnet 4.6 run at 200k;
`[1m]` selects 1M. Opus 4.7/4.8/5/5.5, Sonnet 5/5.5, Haiku 5.5 and
Fable 5/5.1 have native 1M windows. Haiku/Sonnet/Opus 4.5 use 200k.
Unknown ids have no inferred limit. These are model capacities from ids,
not a claim to recover a user's environment-specific compaction overrides.

The card fixtures follow the pinned moo.md `595eda0e3b477d1af1daad82f395073d4f912c8d`
`hunch/hooks/tend.tsx` CARD_RE, cleanCard and latestCard. A real production-launcher
Agent-role run with that bundle and `/hope:intent` produced a complete assistant
card fence; the observation is recorded on [#2681](https://github.com/saadshahd/roundup/issues/2681#issuecomment-6253654054).

`2.1.296-context.jsonl` is the actual `system` record with `subtype: local_command`
that Claude Code 2.1.296 wrote for `claude -p -c '/context'` on 2026-10-22, run in an
isolated temporary project and config with a one-line `CLAUDE.md` after an earlier turn.
Its structured `contextUsage.categories` lists `{name, tokens, kind}`; observed names are
`System prompt`, `System tools`, `Memory files`, `Messages`, `Skills` (kind `used`),
`System tools (deferred)` (`deferred`), `Autocompact buffer` (`buffer`) and `Free space`
(`free`). The `skills` list and the markdown stdout are trimmed. The form is recorded on
[#3306](https://github.com/saadshahd/roundup/issues/3306).
