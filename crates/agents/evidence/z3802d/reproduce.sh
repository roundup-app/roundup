#!/usr/bin/env bash
# Disposable probe dependencies never enter roundup's workspace or production build.
set -euo pipefail
evidence=$(cd "$(dirname "$0")" && pwd)
probe=$(mktemp -d)
trap 'rm -rf "$probe"' EXIT
mkdir -p "$probe/src"
cp "$evidence/probe.rs" "$probe/src/main.rs"
cp "$evidence/probe.toml" "$probe/Cargo.toml"
cp "$evidence/probe.lock" "$probe/Cargo.lock"
cargo build --release --locked --manifest-path "$probe/Cargo.toml"
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
export GIT_AUTHOR_NAME=probe GIT_AUTHOR_EMAIL=probe@example.invalid
export GIT_COMMITTER_NAME=probe GIT_COMMITTER_EMAIL=probe@example.invalid
export GIT_AUTHOR_DATE='2026-10-25T00:00:00Z' GIT_COMMITTER_DATE="$GIT_AUTHOR_DATE"
for backend in files reftable; do
    root="$probe/$backend"
    mkdir -p "$root"
    git init -q --ref-format="$backend" -b main "$root/repo"
    git -C "$root/repo" -c commit.gpgsign=false commit -q --allow-empty -m fixture
    git -C "$root/repo" update-ref refs/roundup/provisioning/a/b HEAD
    git -C "$root/repo" pack-refs --all
    git -C "$root/repo" branch loose
    git -C "$root/repo" worktree add -q -b linked "$root/linked"
done
"$probe/target/release/z3802d-probe" bench "$probe/files/repo"
set +e
"$probe/target/release/z3802d-probe" read "$probe/reftable/repo" refs/heads/main
result=$?
set -e
printf 'reftable comparison exit: %s\n' "$result"
test "$result" -eq 1
