# X8 owner library selection

The installed portable-pty 0.9 supplies the PTY, session leader, original child
handle and resize. RPC supplies the existing newline JSON-RPC client; Terminals
supplies dispatch, output subscriptions, bounded logs, catch-up and screen parsing.
RPC has no reusable server (rupd's connection handler requires the full Daemon),
so the owner serves the same framing and existing methods with creation excluded.
A separate Cargo binary holds those resources independently of client lifetimes.
`cargo build -p terminal --bin terminal-owner` produces the helper on Linux/macOS;
`TerminalOwner::start` takes its installed path explicitly. No system tmux is needed.

Candidates evaluated before implementation:

- [tmux 3.8](https://github.com/tmux/tmux/releases/tag/3.8), released
  2026-09-09: built the release tarball locally. On a private `-S` socket with
  `-f /dev/null`, run `python3 <absolute path>/tmux-query.py <result file>` as
  the session's program. The recorded input was `[27,91,63,49,59,50,99]`
  (`ESC[?1;2c`), though no App scheme had been supplied. This contradicts X17:
  before the first scheme call, nothing is answered. Ordinary attach additionally
  renders a screen rather than replaying the original raw stream. tmux's
  [query handler](https://github.com/tmux/tmux/blob/3.8/input.c) answers DA1 itself.
- [shpool 0.11.5](https://github.com/shell-pool/shpool/releases/tag/v0.11.5),
  released 2026-09-17: its
  [AttachHeader](https://github.com/shell-pool/shpool/blob/692798589341f557843c7c2db8280e8e5cab15a0/shpool-protocol/src/lib.rs)
  cannot request attach-existing-only. A list check cannot prevent a replacement
  launch when the original exits before attach. Its libshpool run entry point is
  unsafe, incompatible with this workspace's forbid policy.
- Selected [portable-pty 0.9](https://docs.rs/portable-pty/0.9.0/portable_pty/),
  maintained in [wezterm](https://github.com/wezterm/wezterm), with the platform's
  separate child lifetime. There is no second PTY, terminal parser or registry.
  The already-locked [nix 0.28](https://docs.rs/nix/0.28.0/nix/) provides safe
  group signalling and Linux descendant reaping. portable-pty's Child::kill
  signals only its leader, which cannot prove the required descendant stop.

The automated observer is `cargo test -p terminal --test durable_owner`.
It invokes its ignored client helper explicitly in two fresh processes. That
helper is not a separate skipped acceptance test. No existing tests were cut:
this new file proves process-independent lifetime, refusal and descendant stop.
