# The one definition of "check": CI runs exactly this. Each line runs even after one fails, and the recipe fails naming every failed line (L89).
# With <base>, the tests run only where the changes since <base> reach; a Builder passes `origin/main` (L89).
[script('loop/keep-going.sh')]
check base="":
    just check-rust {{quote(base)}}
    just check-web {{quote(base)}}

[script('loop/keep-going.sh')]
check-rust base="":
    just lint-rust {{quote(base)}}
    just test-rust-since {{quote(base)}}

# The deterministic checks a Builder run's pushes failed on, run before the push and against origin/main: no browser, no test binary, no real process (L23).
[script('loop/keep-going.sh')]
ready:
    just migrations origin/main
    just lint-web
    just lint-rust origin/main
    python3 loop/app-data.py python3 loop/launch-sites.test.py LaunchSites.test_n7_launch_sites_use_owned_data

# The Rust checks that run no test binary; CI runs them in the `lint` job (L89).
[script('loop/keep-going.sh')]
lint-rust base="":
    python3 tools/file-size/guard.test.py
    python3 tools/file-size/guard.py {{quote(base)}}
    cargo fmt --check
    python3 tools/clippy/selection.test.py
    just clippy {{quote(base)}}
    cargo machete crates
    python3 tools/lint/setup.py rust
    python3 tools/lint/scan.py rust
    spikes/context-injection/e7_report.test.sh
    tools/question-guard/guard.test.sh
    tools/question-guard/guard.sh
    tools/retired-words.test.sh
    tools/retired-words.sh
    tools/library-reuse.test.sh
    tools/library-reuse.sh
    just proofs

# Lints every target of the workspace; CI runs it on Linux and on macOS, whose `target_os = "macos"` code Linux never compiles (L89).
# With <base>, it runs only when the diff since <base> reaches a crate (`loop/affected.py`), so a Builder's web-only diff
# builds no cold Rust before its push (L23).
clippy base="":
    #!/usr/bin/env bash
    set -euo pipefail
    if [ -n "{{base}}" ]; then
        crates=$(python3 loop/affected.py rust {{quote(base)}})
        if [ -z "$crates" ]; then
            echo "no Rust crate reaches the diff since {{base}}: clippy skipped"; exit 0
        fi
    fi
    exec cargo clippy --all-targets -- -D warnings

# The Rust tests; CI passes nextest a lane's profile (`ci1` to `ci5`), a thread count or the `mac` profile (L89).
[script('loop/keep-going.sh')]
test-rust *args:
    cargo build --quiet -p rupd -p rup
    cargo nextest run {{args}}
    just contracts-fresh

# L89: `test-rust` on the crates whose tests the diff since <base> reaches (`loop/affected.py`); every crate when <base> is empty.
test-rust-since base *args:
    #!/usr/bin/env bash
    set -euo pipefail
    crates=$(python3 loop/affected.py rust {{quote(base)}})
    case $crates in
        all) exec just test-rust {{args}} ;;
        '') echo "no Rust test reaches the diff since {{base}}" ;;
        *) exec just test-rust $(printf -- '-p %s ' $crates) --no-tests pass {{args}} ;;
    esac

# The web checks, with the tests the diff since <base> reaches; every test when <base> is empty (L89).
[script('loop/keep-going.sh')]
check-web base="":
    just lint-web
    just test-web-since {{quote(base)}}

# The web checks that run no test; CI runs them in the `lint-web` job (L89).
[script('loop/keep-going.sh')]
lint-web:
    loop/rules.sh scenario-ids
    test -z "$(find .claude/skills -xtype l)"
    pnpm lint
    pnpm lint:styles
    pnpm tokens:check
    pnpm typecheck
    pnpm slop
    pnpm lint:boundaries
    ! pnpm --filter desktop exec vitest list --filesOnly src/perf/r3841_ready.test.ts 2>&1 | grep -F "configLoader: 'native'"
    pnpm lint:cycles
    just packages typecheck

# L89: the web tests the diff since <base> reaches (`loop/affected.py`), through vitest's module graph; every test when <base> is empty. CI passes vitest a shard.
test-web-since base *args:
    #!/usr/bin/env bash
    set -euo pipefail
    files=$(python3 loop/affected.py web {{quote(base)}})
    case $files in
        all) exec just packages test {{args}} ;;
        '') echo "no web test reaches the diff since {{base}}" ;;
        *) exec pnpm --filter desktop exec vitest related --run {{args}} $files ;;
    esac

# L89: rewrites the web shard durations from the vitest reports in the logs of the `web` jobs of a `main` run of check.yml (pick one with `gh run list --branch main --workflow check.yml`).
web-durations run:
    #!/usr/bin/env bash
    set -euo pipefail
    for job in $(gh run view {{run}} --json jobs --jq '.jobs[] | select(.name | startswith("web ")) | .databaseId'); do
        gh api --allow-escape-sequences "repos/{owner}/{repo}/actions/jobs/$job/logs"
    done | loop/web-durations.py > apps/desktop/src/testing/shardDurations.json.new
    mv apps/desktop/src/testing/shardDurations.json.new apps/desktop/src/testing/shardDurations.json

# Regenerate every contract surface from its declarations and type metadata.
contracts:
    cargo run --quiet -p contracts --features export --bin contracts -- contracts/generated

contracts-test:
    python3 -m unittest discover -s tools/contracts

contracts-fresh:
    python3 tools/contracts/fresh.py

# Runs a script in every pnpm workspace package (apps/*, ext/*), passing it <args>; packages without it are skipped, no packages is a pass.
packages script *args:
    pnpm -r --if-present {{script}} {{args}}

# Serves the real App on a fake Daemon holding the named seed (U26) and prints the URL (pass another port when 5199 is taken); no Daemon, Tauri or display needed.
harness seed="tree-40" port="5199":
    @echo "http://localhost:{{port}}/harness.html?seed={{seed}}"
    pnpm --filter desktop exec vite --port {{port}} --strictPort

# Serves the real App on the running `rupd` of a Project (U144) at http://localhost:<port>/harness.html?daemon=1; start `rupd` first, with RUPD_SOCKET if it has one. Loopback only.
harness-real project port="5199":
    #!/usr/bin/env bash
    set -euo pipefail
    path=$(cd {{quote(invocation_directory())}} && realpath -- {{quote(project)}})
    echo "http://localhost:{{port}}/harness.html?daemon=1"
    ROUNDUP_REAL_PROJECT="$path" pnpm --filter desktop exec vite --host 127.0.0.1 --port {{port}} --strictPort

# Prepare debug Daemon/CLI binaries and the SDK runtime beside them (A4691a).
build-debug:
    cargo build -p rupd -p rup -p terminal
    tools/sidecar/bundle.sh target/debug/sidecar --local-node

# Opens the development App only after its imports transform; an HTML response alone can hide a Vite error.
app project:
    #!/usr/bin/env bash
    set -euo pipefail
    path=$(cd {{quote(invocation_directory())}} && realpath -- {{quote(project)}})
    # Anything already on :5173 would answer the wait below in place of our Vite and the window would open on the wrong webview.
    ! curl --max-time 1 -sf -o /dev/null http://localhost:5173 || { echo "something already answers on :5173; stop it first" >&2; exit 1; }
    CI=true pnpm install --frozen-lockfile
    just build-debug
    set -m
    pnpm --filter "./apps/*" --if-present dev &
    dev=$!
    set +m
    trap 'kill -- -"$dev" 2>/dev/null || true' EXIT
    # The window loads devUrl once and does not retry, so it must not open before Vite answers.
    deadline=$((SECONDS + 30))
    while (( SECONDS < deadline )); do
        kill -0 "$dev" 2>/dev/null || { echo "dev server exited before answering on :5173" >&2; exit 1; }
        curl --max-time 1 -sf -o /dev/null http://localhost:5173 && break
        sleep 0.2
    done
    (( SECONDS < deadline )) || { echo "dev server did not answer on :5173 within 30 s" >&2; exit 1; }
    curl --max-time 30 --fail-with-body -sS http://localhost:5173/__roundup_ready || { echo "webview imports are not ready; App was not opened" >&2; exit 1; }
    cargo run -p desktop -- "$path"

# Builds the webview files, then rupd, rup and the App (custom-protocol, serving apps/desktop/dist) in release mode, and runs the App on them with no dev server. No bundling or signing.
app-release project:
    #!/usr/bin/env bash
    set -euo pipefail
    path=$(cd {{quote(invocation_directory())}} && realpath -- {{quote(project)}})
    pnpm -r --if-present build
    cargo build --release -p rupd -p rup -p terminal
    tools/sidecar/bundle.sh target/release/sidecar
    cargo build --release -p desktop --features custom-protocol
    cargo run --release -p desktop --features custom-protocol -- "$path"

# S1/A12a: assemble a host-architecture macOS App with Tauri. Ordinary Cargo builds use no bundle inputs.
app-bundle:
    #!/usr/bin/env bash
    set -euo pipefail
    [ "$(uname -s)" = Darwin ] || { echo "app-bundle requires macOS" >&2; exit 2; }
    triple=$(rustc -vV | sed -n 's/^host: //p')
    CI=true pnpm install --frozen-lockfile
    pnpm -r --if-present build
    cargo build --release --target "$triple" -p rupd -p rup -p terminal
    mkdir -p target/app-bundle-inputs
    for bin in rupd rup terminal-owner; do
        cp "target/$triple/release/$bin" "target/app-bundle-inputs/$bin-$triple"
    done
    tools/sidecar/bundle.sh target/app-bundle-inputs/sidecar
    cd crates/desktop
    npm exec --yes --package=@tauri-apps/cli@2.12.4 -- tauri build --ci --target "$triple" --features custom-protocol --bundles app --no-sign --config tauri.bundle.conf.json

# Observe an already-built App after extraction, including the existing recovery and shutdown proofs.
[positional-arguments]
app-bundle-check bundle:
    #!/usr/bin/env python3
    import json
    import os
    from pathlib import Path
    import shutil
    import subprocess
    import sys
    import tempfile
    
    source = Path(sys.argv[1]).resolve(strict=True)
    with tempfile.TemporaryDirectory(prefix="roundup-bundle-") as folder:
        extracted = Path(folder).resolve() / source.name
        shutil.copytree(source, extracted, symlinks=True)
        binaries = extracted / "Contents/MacOS"
        for name in ["roundup", "rupd", "rup", "terminal-owner", "sidecar/node"]:
            binary = binaries / name
            if (not binary.is_file() or not os.access(binary, os.X_OK)
                    or not binary.resolve().is_relative_to(extracted)):
                raise SystemExit(f"missing executable: {binary}")
        sidecar = binaries / "sidecar"
        for path in sidecar.rglob("*"):
            if path.is_symlink() and not path.resolve().is_relative_to(extracted):
                raise SystemExit(f"sidecar depends on an external file: {path}")
        for name in ["list.mjs", "package.json", "NOTICES.md", "NODE-LICENSE",
                     "node_modules/@anthropic-ai/claude-agent-sdk/LICENSE.md"]:
            if not (sidecar / name).is_file():
                raise SystemExit(f"missing sidecar file: {name}")
        version = subprocess.check_output([sidecar / "node", "--version"], text=True).strip()
        if version != "v22.23.3":
            raise SystemExit(f"unexpected Node runtime: {version}")
        print(f"pinned Node: {version}", flush=True)
        # Import from the extracted module tree with the bundled runtime, not the checkout.
        subprocess.run([sidecar / "node", "--input-type=module", "-e",
                        "import {listSessions} from '@anthropic-ai/claude-agent-sdk';"
                        "if(typeof listSessions !== 'function') process.exit(1)"],
                       cwd=sidecar, check=True)
        print(json.dumps({"executables": str(binaries), "sidecar": "SDK import passed"}), flush=True)
        environment = os.environ.copy()
        for name in ["ROUNDUP_RUPD_BIN", "ROUNDUP_RUP_BIN", "ROUNDUP_SIDECAR_DIR",
                     "RUPD_TERMINAL_OWNER"]:
            environment.pop(name, None)
        environment["ROUNDUP_TEST_APP_BIN"] = str(binaries)
        subprocess.run([
            "cargo", "nextest", "run", "-p", "desktop", "-p", "terminal", "-p", "rup",
            "--test", "a12a", "--test", "durable_owner", "--test", "reopen", "-E",
            "binary(a12a) | binary(reopen) | test(=x8_reconnecting_keeps_the_original_program)",
        ], env=environment, check=True)

# S12: renders the App's 1024 px Dock icon from the approved artwork; needs macOS's sips.
icon:
    sips -z 1024 1024 crates/desktop/icons/artwork.png --out crates/desktop/icons/icon.png >/dev/null

# Rule 7 as a command: measures a fresh Daemon (median of 11 runs), writes target/perf.json, fails on a miss against crates/perf/budgets.json.
perf *args:
    cargo build --release -p rupd -p rup -p perf
    tools/sidecar/bundle.sh target/release/sidecar
    ./target/release/perf {{args}}

# Keystroke-to-render p95 in the real App's WKWebView (macOS only; scenarios/perf.md K1-K3, R11). Builds the App with the probe into target/perf-app and opens its window, kept above every other window and Space, for about 40 s per run, and refuses unless ROUNDUP_ALLOW_WINDOW=1.
perf-keystroke *args:
    #!/usr/bin/env bash
    set -euo pipefail
    [ "${ROUNDUP_ALLOW_WINDOW:-}" = 1 ] || { echo "perf-keystroke opens a window over your screen for about 40 s per run and types into it; set ROUNDUP_ALLOW_WINDOW=1 only when the user asked for the run" >&2; exit 2; }
    dist={{quote(justfile_directory())}}/target/perf-dist
    workload=idle
    for arg in {{args}}; do [ "$arg" != --flood ] || workload=flood; done
    VITE_ROUNDUP_PERF=1 VITE_ROUNDUP_PERF_WORKLOAD="$([ "$workload" = flood ] && echo flood || true)" pnpm --filter desktop exec vite build --outDir "$dist" --emptyOutDir
    TAURI_CONFIG=$(jq -nc --arg dist "$dist" '{build: {frontendDist: $dist}, app: {windows: [{title: "roundup", alwaysOnTop: true, visibleOnAllWorkspaces: true}]}}') \
        cargo build --release -p rupd -p rup -p desktop --features desktop/custom-protocol --target-dir target/perf-app
    cargo build --release -p perf
    ./target/release/perf-keystroke {{args}}

# The frame-interval run of one `docs/motion.md` workload (glyphs, layers or todos) in the real App's WKWebView (macOS only; scenarios/ui-motion.md U3010e, runbook docs/motion-native-runbook.md). Builds the App with the recorder into target/perf-app and opens its window, kept above every other window and Space, for about 100 s, and refuses unless ROUNDUP_ALLOW_WINDOW=1.
perf-frames workload *args:
    #!/usr/bin/env bash
    set -euo pipefail
    [ "${ROUNDUP_ALLOW_WINDOW:-}" = 1 ] || { echo "perf-frames opens a window over your screen for about 100 s and drives it; set ROUNDUP_ALLOW_WINDOW=1 only when the user asked for the run" >&2; exit 2; }
    dist={{quote(justfile_directory())}}/target/perf-dist
    VITE_ROUNDUP_PERF=1 VITE_ROUNDUP_PERF_WORKLOAD={{quote(workload)}} pnpm --filter desktop exec vite build --outDir "$dist" --emptyOutDir
    TAURI_CONFIG=$(jq -nc --arg dist "$dist" '{build: {frontendDist: $dist}, app: {windows: [{title: "roundup", alwaysOnTop: true, visibleOnAllWorkspaces: true}]}}') \
        cargo build --release -p rupd -p rup -p desktop --features desktop/custom-protocol --target-dir target/perf-app
    cargo build --release -p perf
    ./target/release/perf-keystroke --frames --out target/perf-frames-{{workload}}.json {{args}}

# V1: checksum-checked Bend and Lean v4.34.0 via elan; verify both versions on every setup.
proofs-setup:
    proofs/setup.sh

# V2: ordinary proof, Lean-checked --verdict, and eight mutation refusals. `just check` runs it.
proofs: proofs-setup
    proofs/proofs.test.sh
    proofs/check.sh

# L105: the web tests with the captures of the named ids (comma-separated, as on the PR's `Scenarios:` line) written to artifacts/ux/<id>/ (images and videos stay untracked: attach them to the PR with `gh pr edit --attach`); `just check` writes none.
capture ids:
    ROUNDUP_CAPTURES={{quote(ids)}} just packages test

# R24: six release idle phases in WKWebView; never run this opt-in from Linux/CI.
perf-idle *args:
    #!/usr/bin/env bash
    set -euo pipefail
    [ "${ROUNDUP_ALLOW_WINDOW:-}" = 1 ] || { echo "perf-idle opens a native window and requires focus/hide interaction for six phases; set ROUNDUP_ALLOW_WINDOW=1 only for an authorized Mac round" >&2; exit 2; }
    [ "$(uname -s)" = Darwin ] || { echo "perf-idle unsupported host: $(uname -s); macos required" >&2; exit 2; }
    rg -q '^\[profile.release\]' Cargo.toml || { echo "perf-idle: release-profile implementation #3807 must land before native calibration (#3777 delivered its specification)" >&2; exit 2; }
    mkdir -p target
    build_log=$(mktemp -d target/perf-idle-build.XXXXXX)
    set +e
    (
        set -ex
        dist={{quote(justfile_directory())}}/target/perf-idle-dist
        VITE_ROUNDUP_IDLE_PERF=1 pnpm --filter desktop exec vite build --outDir "$dist" --emptyOutDir
        TAURI_CONFIG=$(jq -nc --arg dist "$dist" '{build: {frontendDist: $dist}}') \
            cargo build --release -p rupd -p rup -p desktop --features desktop/custom-protocol,desktop/idle-perf --target-dir target/perf-idle-app
        cargo build --release -p perf --bin perf-idle
    ) > >(tee "$build_log/stdout") 2> >(tee "$build_log/stderr" >&2)
    build_status=$?
    set -e
    if [ "$build_status" -ne 0 ]; then
        jq -n --argjson status "$build_status" --arg raw "$build_log" '{exit: 2, build_status: $status, raw: $raw, native_validation: "not measured", memory_status: "provisional", phases: ["10 focused", "10 unfocused", "10 hidden", "1 focused", "1 unfocused", "1 hidden"], error: "release build failed; command and output retained"}' | tee "$build_log/report.json"
        [ -e target/perf-idle.json ] || cp "$build_log/report.json" target/perf-idle.json
        exit 2
    fi
    ./target/release/perf-idle {{args}}

# B4522: filename-only Git-tree guard and fixtures; no build or dependencies.
migrations base="":
    python3 tools/migrations/guard.py {{quote(base)}}
    python3 tools/migrations/guard.test.py
