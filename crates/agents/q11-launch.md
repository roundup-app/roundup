# Q11 launch observation

Claude Code 2.1.296, Linux, 2026-10-14. Isolated temporary Project and
CLAUDE_CONFIG_DIR; no model request, user plugin installation or startup fetch.
The same Launcher and Project supply both role configurations. The real vendor
hook loader probe succeeds before inventory is requested through those argv.

```sh
ROUNDUP_CLAUDE=/home/runner/.local/bin/claude \
  cargo test -p agents --test launch q11_real_claude_loads_three_plugins \
  -- --ignored --nocapture
```

Claude's `plugin list --json` reports, for both Door and child:

| id | version | scope | enabled |
|---|---|---|---|
| hope@inline | 13.1.0 | session | true |
| hunch@inline | 0.9.4 | session | true |
| hold@inline | 0.0.9 | session | true |

Each installPath points to that plugin under the same roundup-owned
`q11-plugins-…` directory. The directories remain readable across initial,
resume and clear configurations. This is the vendor's loaded session inventory,
not a fake argv report. It does not claim model style compliance.
