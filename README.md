<img src="crates/desktop/icons/icon.png" width="128" alt="">

# roundup

A lean, extensible, open-source Claude Code workbench: terminals, agents, todos and scratchpads. macOS only for now. No accounts, sync or telemetry.

Status: in development; the Daemon, `rup` and the macOS App run. See `docs/architecture.md`, `docs/wireframes.md` and `docs/extension-interface.md`. Terms are named in `GLOSSARY.md`; the scenario that introduces a term defines it.

## Install

Needs: macOS on Apple Silicon (the bundles are `aarch64` only), and `claude` and `herdr-core` 0.1.21 or newer on your login-shell `PATH`. No checkout is needed.

Stable and Dev install side by side and never share data. Both update themselves: Settings › Updates installs a newer roundup or herdr-core when you press its button, and "Update available" in the application menu opens it.

### Stable

The newest `v0.1.0-alpha.<n>` release holds the bundle; the `alpha` release's `latest.json` names it. Until the first `just promote`, no Stable release exists.

```sh
tag=$(gh release list -R roundup-app/roundup --json tagName --jq '[.[].tagName | select(startswith("v0.1.0-alpha."))][0]')
gh release download "$tag" -R roundup-app/roundup -p 'roundup-stable_*_aarch64.app.tar.gz' -O - | tar -xz -C /Applications
open /Applications/Roundup.app
```

### Dev

The rolling `dev` release holds one `roundup-dev_0.1.0-dev.<n>_aarch64.app.tar.gz`.

```sh
gh release download dev -R roundup-app/roundup -p 'roundup-dev_*_aarch64.app.tar.gz' -O - | tar -xz -C /Applications
```

Without a Fork, Dev starts nothing. Install Stable and open it first, then run this in a Terminal inside Stable (it copies the live data through Stable's Daemon, whose socket a plain shell cannot find: "no Daemon answered at ~/.roundup/rupd.sock"; `echo $RUPD_SOCKET` there prints a path):

```sh
"/Applications/Roundup Dev.app/Contents/MacOS/rup" data fork ~/.roundup/forks/dev --name Dev --colour violet
```

Then open Dev: `open "/Applications/Roundup Dev.app"`.

### Source

Contributors build from a checkout with `just app <project>`.

The CLI binary is `rup`; the daemon is `rupd`.

License: MIT.
