# M15 interactive permission source

Issue #1552 remains unimplemented. This fixture tests the native source candidate,
not adapter/MCP parity. Run it from the repository root:

```sh
python3 crates/agents/src/claude_code/m15_interactive.py
```

The installed Claude Code **2.1.296** comparison exits **1**. Full argv, vendor
replies, interactive identity, tool lists and exits are in
[m15-interactive.json](m15-interactive.json). Every Claude invocation exits **0**.

| Role | CLI touch grant | echo | touch | matching deny |
|---|---|---|---|---|
| Agent | absent | allow | ask | deny |
| Agent | present | allow | allow | deny |
| Door | absent | source error | source error | source error |
| Door | present | source error | source error | source error |

Each Door error is `$.tool.check: no tool named "Bash" in this session`.
`Read,Grep,Glob,ToolSearch` remains its native tool list. A missing evaluator is
not a user's denial. Both roles' file settings contain only the echo launch
allow, even when the same instance allows touch through `--allowedTools`.
Both roles' config row says **Default permission mode**, value `default`, although
argv selects current mode `manual`.

The fixture creates a fresh HOME, config, trusted Project and mod per invocation,
submits no model prompt, executes no evaluated command and opens no native
permission dialog. It waits on a completed-response marker with a deadline,
records malformed/missing replies and vendor exits as failures, reaps only its
own children and removes its temporary directories.

The [mods reference](https://code.claude.com/docs/en/plugins/mods/reference)
lists settings reads and tool checks, but no live permission-context getter.
The installed implementation of `$.tool.check` looks up the tool in the live
tool list before evaluating permissions. Its `list_permission_rules` handler
is in the SDK input loop; `--sdk-url` is documented in installed help as requiring
print/stream-json mode. Neither establishes an interactive adapter source.

Still required: the adapter source and live Attempt binding; current mode;
effective sourced rules and trusted directories; source errors; next-call file,
in-memory and mode changes; and adapter exit, malformed-response and timeout
handling. No result here completes #1552, #1550 or #1501.
