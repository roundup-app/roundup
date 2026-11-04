#!/usr/bin/env bash
# SU5982: build the new main into a spare Build slot, check it on a fresh Fork of the live data, and
# only then point `good` at it. Exit: 0 passed or nothing to do, 1 build, 2 fork, 3 ping, 4 open, 5 no spare slot.
#
# Environment: ROUNDUP_HOME (slots/ lives under it), ROUNDUP_SLOT (the slot the App runs from, default A),
# ROUNDUP_DATA_DIR (the live data folder), UPDATE_SOURCE (the App's source checkout), UPDATE_REF (default
# origin/main), UPDATE_BUILD (the build command run inside the slot), UPDATE_BIN (built programs, relative to the slot).
# `rup` talks to the live Daemon through RUPD_SOCKET for the Fork and starts nothing.
set -euo pipefail

home=${ROUNDUP_HOME:-$HOME/.roundup}
slots=$home/slots
running=${ROUNDUP_SLOT:-A}
source_dir=${UPDATE_SOURCE:-$(cd "$(dirname "$0")/../.." && pwd)}
ref=${UPDATE_REF:-origin/main}
build_cmd=${UPDATE_BUILD:-just build-debug}
bin=${UPDATE_BIN:-target/debug}
mkdir -p "$slots"

good() { [ -f "$slots/good" ] && cat "$slots/good" || true; }

if [ "${1:-}" = --rollback ]; then
    [ -f "$slots/good.previous" ] || { echo "no earlier good to restore" >&2; exit 1; }
    cp "$slots/good" "$slots/good.next" 2>/dev/null || true
    cp "$slots/good.previous" "$slots/good.tmp"
    mv "$slots/good.tmp" "$slots/good"
    [ -f "$slots/good.next" ] && mv "$slots/good.next" "$slots/good.previous"
    echo "good: $(good)"
    exit 0
fi

# A newer move supersedes a build in flight: stop it before this one starts, so two never run together.
if [ -f "$slots/update.pid" ]; then
    old=$(cat "$slots/update.pid")
    if [ "$old" != "$$" ] && kill -0 "$old" 2>/dev/null; then
        kill "$old" 2>/dev/null || true
        for _ in $(seq 50); do kill -0 "$old" 2>/dev/null || break; sleep 0.2; done
    fi
fi
echo $$ > "$slots/update.pid"

job=
tmp=
daemons=()
finish() {
    code=$?
    trap - EXIT
    [ -z "$job" ] || kill -- -"$job" 2>/dev/null || true
    for pid in ${daemons[@]+"${daemons[@]}"}; do kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; done
    [ -z "$tmp" ] || rm -rf "$tmp"
    [ "$(cat "$slots/update.pid" 2>/dev/null)" != "$$" ] || rm -f "$slots/update.pid"
    exit "$code"
}
trap finish EXIT
trap 'exit 143' TERM INT

git -C "$source_dir" fetch -q origin 2>/dev/null || true
commit=$(git -C "$source_dir" rev-parse "$ref")

built() { [ -f "$slots/$1/.built" ] && cat "$slots/$1/.built" || true; }
if [ "$(built "$(good)")" = "$commit" ] && [ -n "$(good)" ]; then
    echo "up to date: $(good) holds $commit"
    exit 0
fi

# The spare slot is neither the one the App runs from nor the one `good` names.
spare=
for name in A B; do
    if [ "$name" != "$running" ] && [ "$name" != "$(good)" ]; then spare=$name; break; fi
done
[ -n "$spare" ] || { echo "no spare slot: restart to update first" >&2; exit 5; }
slot=$slots/$spare

fail() { # step code cause
    printf '%s\n' "$3" | python3 -I -c '
import json, sys
print(json.dumps({"commit": sys.argv[1], "step": sys.argv[2], "cause": sys.stdin.read().rstrip("\n")}))' "$commit" "$1" > "$slot/failed.json"
    echo "update failed at $1" >&2
    exit "$2"
}

rm -f "$slot/failed.json"
if [ "$(built "$spare")" != "$commit" ]; then
    if [ -e "$slot/.git" ]; then
        git -C "$slot" checkout -q --detach -f "$commit"
        git -C "$slot" clean -qfd
    else
        git -C "$source_dir" worktree prune
        git -C "$source_dir" worktree add -q -f --detach "$slot" "$commit"
    fi
    rm -f "$slot/.built"
    echo "building $commit in slot $spare"
    log=$(mktemp)
    set -m
    (cd "$slot" && exec bash -c "$build_cmd") >"$log" 2>&1 &
    job=$!
    set +m
    if wait "$job"; then job=; else job=; cause=$(tail -n 20 "$log"); rm -f "$log"; fail build 1 "$cause"; fi
    rm -f "$log"
    echo "$commit" > "$slot/.built"
fi

tmp=$(mktemp -d)
fork=$tmp/fork
rup=$slot/$bin/rup
echo "check: fork of the live data"
out=$("$rup" data fork "$fork" --name update-check --colour teal --json 2>&1) || fail fork 2 "$(printf '%s\n' "$out" | tail -n 20)"

# Starts the slot's Daemon on the Fork for one Project folder and waits up to 30 s for daemon.ping.
daemon_on() { # folder socket
    local pid
    ROUNDUP_DATA_DIR=$fork RUPD_SOCKET=$2 "$slot/$bin"/rup? "$1" >"$tmp/daemon.log" 2>&1 &
    pid=$!
    daemons+=("$pid")
    for _ in $(seq 150); do
        if [ -S "$2" ] && RUPD_SOCKET=$2 "$rup" ping 2>/dev/null | grep -q .; then return 0; fi
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.2
    done
    return 1
}
stop_daemons() {
    for pid in ${daemons[@]+"${daemons[@]}"}; do kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; done
    daemons=()
}

mkdir "$tmp/scratch"
daemon_on "$tmp/scratch" "$tmp/ping.sock" || fail ping 3 "no daemon.ping within 30 s: $(tail -n 20 "$tmp/daemon.log")"
stop_daemons

n=0
while IFS= read -r project; do
    [ -n "$project" ] || continue
    n=$((n + 1))
    if daemon_on "$project" "$tmp/open$n.sock"; then
        echo "opened $project"
    else
        fail open 4 "$project: $(tail -n 20 "$tmp/daemon.log")"
    fi
    stop_daemons
done < <(python3 -I -c '
import json, sys
try:
    print("\n".join(json.load(open(sys.argv[1] + "/projects.json"))["open"]))
except FileNotFoundError:
    pass' "${ROUNDUP_DATA_DIR:?the live data folder}")

stop_daemons
rm -rf "$tmp"; tmp=
echo "check passed: $commit"
[ -z "$(good)" ] || cp "$slots/good" "$slots/good.previous"
printf '%s\n' "$spare" > "$slots/good.tmp"
mv "$slots/good.tmp" "$slots/good"
echo "good: $spare"
