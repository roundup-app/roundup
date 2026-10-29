# Build a macOS App

On macOS, with the repository's Rust, Node/npm and pnpm tools installed:

```sh
just app-bundle
```

This installs the frozen workspace dependencies, builds the webview and native helpers,
prepares the pinned Node/SDK sidecar, and invokes Tauri CLI 2.12.4. It produces the
host-architecture `target/<rust-host>/release/bundle/macos/roundup.app`:

```text
roundup.app/Contents/
├── MacOS/
│   ├── roundup
│   ├── rupd
│   ├── rup
│   ├── terminal-owner
│   └── sidecar/
│       ├── node
│       ├── list.mjs
│       ├── package.json
│       ├── NOTICES.md
│       ├── NODE-LICENSE
│       └── node_modules/
└── Resources/
```

Tauri's `bundle.externalBin` removes the target suffixes from preparation inputs.
Its `bundle.macOS.files` copies the complete sidecar to `Contents/MacOS/sidecar`,
where the existing Daemon locator reads it. The App's existing `Config::locate`
finds the adjacent Daemon and Terminal owner. No runtime lookup uses the checkout.
`tools/sidecar/bundle.sh` supplies checksum-verified Node 22.23.3, the locked SDK,
and notices, dereferencing workspace links before Tauri copies the directory.

The opt-in `crates/desktop/tauri.bundle.conf.json` keeps generated inputs out of
plain Cargo and mock-runtime builds. `just app` and `just app-release <project>`
keep their unbundled behavior. This local recipe passes `--no-sign`; Tauri owns
assembly and supports signing integration. Signing, notarization, publishing,
universal binaries and platform appearance variants are outside this command.

## Observe the extracted bundle

```sh
just app-bundle-check target/<rust-host>/release/bundle/macos/roundup.app
```

The observer copies the actual bundle to a fresh temporary directory. It requires
all four executables, the runtime and notices, refuses external sidecar symlinks,
and imports the SDK using that extracted Node. It runs the existing App discovery,
X8 reconnection, U4547e recovery and D5 attached-shutdown tests against the extracted
helpers. The Daemon fixture removes CLI and sidecar lookup overrides in this mode;
only its fake local vendor program, isolated Project/data and socket are configured.
The selected Terminal owner path is the one adjacent to the extracted App, matching
the App's handoff. Test compilation still requires this checkout; executing the
packaged helpers and importing the sidecar do not.

This is a build/process observation, needs no window or logged-in vendor, and can
run on a macOS CI runner. It does not replace #4802's remaining Agent recovery and
distinct-socket work. Each failure stops the command with a nonzero exit status.

## Reuse

The installed Tauri 2.12.1, tauri-build 2.7.1 and tauri-utils 2.10.1 already own App
configuration and runtime embedding. The recipe selects the maintained
[Tauri CLI/bundler](https://github.com/tauri-apps/tauri/releases/tag/tauri-cli-v2.12.4)
(released 2026-10-21). Its [sidecar contract](https://v2.tauri.app/develop/sidecar/)
and [configuration](https://v2.tauri.app/reference/config/) provide `externalBin`
and `macOS.files`; no custom App assembler or locator is needed.

[CrabNebula cargo-packager](https://github.com/crabnebula-dev/cargo-packager)
was also considered ([0.11.8 release](https://github.com/crabnebula-dev/cargo-packager/releases/tag/%40crabnebula/packager-v0.11.8),
2025-11-27; repository updated 2026-10-28). It supports macOS bundles but does not
consume Tauri's `bundle.externalBin`/`macOS.files` configuration or its build hooks;
using it would require a second packaging configuration and signing entry point,
which this work order excludes. Preparation uses existing Cargo, the pinned sidecar
helper and platform file copying; extraction uses Python's standard `shutil` and
`tempfile`, with existing scenario tests supplying the process observers.
