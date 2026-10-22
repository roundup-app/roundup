# The one definition of "check": CI runs exactly this. Each line runs even after one fails, and the recipe fails naming every failed line (L89).
# With <base>, the tests run only where the changes since <base> reach; a Builder passes `origin/main` (L89).
[script('loop/keep-going.sh')]
check base="":
    just check-rust {{quote(base)}}
    just check-web {{quote(base)}}

[script('loop/keep-going.sh')]
check-rust base="":
    just lint-rust
    just test-rust-since {{quote(base)}}

# The Rust checks that run no test binary; CI runs them in the `lint` job (L89).
[script('loop/keep-going.sh')]
lint-rust:
    cargo fmt --check
    just clippy
    cargo machete crates
    spikes/context-injection/e7_report.test.sh
    just proofs

# Lints every target of the workspace; CI runs it on Linux and on macOS, whose `target_os = "macos"` code Linux never compiles (L89).
clippy:
    cargo clippy --all-targets -- -D warnings

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

# Fails when the generated TypeScript differs from the Rust contract (tests regenerate it).
contracts-fresh:
    git diff --exit-code -- contracts/generated
    test -z "$(git ls-files --others --exclude-standard contracts/generated)"

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

# Opens the development App only after its imports transform; an HTML response alone can hide a Vite error.
app project:
    #!/usr/bin/env bash
    set -euo pipefail
    path=$(cd {{quote(invocation_directory())}} && realpath -- {{quote(project)}})
    # Anything already on :5173 would answer the wait below in place of our Vite and the window would open on the wrong webview.
    ! curl --max-time 1 -sf -o /dev/null http://localhost:5173 || { echo "something already answers on :5173; stop it first" >&2; exit 1; }
    CI=true pnpm install --frozen-lockfile
    cargo build -p rupd -p rup
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
    cargo build --release -p rupd -p rup
    cargo build --release -p desktop --features custom-protocol
    cargo run --release -p desktop --features custom-protocol -- "$path"

# S12: renders the App's 1024 px Dock icon from the approved artwork; needs macOS's sips.
icon:
    sips -z 1024 1024 crates/desktop/icons/artwork.png --out crates/desktop/icons/icon.png >/dev/null

# Rule 7 as a command: measures a fresh Daemon (median of 11 runs), writes target/perf.json, fails on a miss against crates/perf/budgets.json.
perf *args:
    cargo build --release -p rupd -p rup -p perf
    ./target/release/perf {{args}}

# Keystroke-to-render p95 in the real App's WKWebView (macOS only; scenarios/perf.md K1-K3, R11). Builds the App with the probe into target/perf-app and opens its window, kept above every other window and Space, for about 40 s per run, and refuses unless ROUNDUP_ALLOW_WINDOW=1.
perf-keystroke *args:
    #!/usr/bin/env bash
    set -euo pipefail
    [ "${ROUNDUP_ALLOW_WINDOW:-}" = 1 ] || { echo "perf-keystroke opens a window over your screen for about 40 s per run and types into it; set ROUNDUP_ALLOW_WINDOW=1 only when the user asked for the run" >&2; exit 2; }
    dist={{quote(justfile_directory())}}/target/perf-dist
    VITE_ROUNDUP_PERF=1 pnpm --filter desktop exec vite build --outDir "$dist" --emptyOutDir
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

# V1: installs the Bend that proofs/BEND_VERSION pins into proofs/.tools/ (checksum checked); a no-op once installed.
proofs-setup:
    proofs/setup.sh

# V2: prints ALL PROOFS CHECK from `bend proofs/messages/PROOF.bend` and exits 0 only then. `just check` runs it.
proofs: proofs-setup
    proofs/proofs.test.sh
    proofs/check.sh

# L105: the web tests with the captures of the named ids (comma-separated, as on the PR's `Scenarios:` line) written to artifacts/ux/<id>/ (images and videos stay untracked: attach them to the PR with `gh pr edit --attach`); `just check` writes none.
capture ids:
    ROUNDUP_CAPTURES={{quote(ids)}} just packages test
