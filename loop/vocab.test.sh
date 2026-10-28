#!/usr/bin/env bash
# Tests for loop/vocab.sh, each in a throwaway git repo. Usage: loop/vocab.test.sh
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
failures=0

new_repo() {
  dir=$(mktemp -d)
  cd "$dir"
  git init -q -b main
  git config user.email t@t
  git config user.name t
  mkdir loop crates contracts
  cp "$here/vocab.sh" "$here/rules.sh" loop/
  printf '_Avoid_: session, bot, process\n_Avoid_: parent agent\n' >GLOSSARY.md
  echo 'pub fn ok() {}' >crates/a.rs
  git add -A
  git commit -qm base
  git checkout -q -b work
}

commit() { git add -A && git commit -qm "$1" -m "${2:-}"; }

expect() {
  local want=$1 name=$2
  shift 2
  if "$@" >/dev/null 2>&1; then got=pass; else got=fail; fi
  if [ "$got" != "$want" ]; then echo "FAIL: $name (wanted $want, got $got)"; failures=$((failures + 1)); else echo "ok:   $name"; fi
}

vocab() { loop/vocab.sh; }

new_repo
expect pass "L3 vocab: clean" vocab
for decl in 'pub fn session_id() {}' 'pub const fn session_id() {}' 'pub struct Sessions;' 'pub struct S {\n    pub session: u8,\n}' 'pub(crate) fn bot() {}' 'pub fn parent_agent() {}' 'pub fn list_processes() {}'; do
  new_repo; printf '%b\n' "$decl" >crates/b.rs; commit x
  expect fail "L3 vocab: $decl" vocab
done
new_repo; mkdir -p crates/agents/src/claude_code; echo 'pub fn session_id() {}' >crates/agents/src/claude_code/a.rs; commit x
expect pass "L3 vocab: claude_code adapter is exempt" vocab
new_repo; mkdir -p crates/other/claude_code; echo 'pub fn session_id() {}' >crates/other/claude_code/a.rs; commit x
expect fail "L3 vocab: another claude_code dir is not exempt" vocab
new_repo; echo 'export type SessionId = string;' >contracts/a.ts; commit x
expect fail "L3 vocab: TS export" vocab
new_repo; rm GLOSSARY.md; echo 'pub fn session_id() {}' >crates/b.rs; commit x
expect fail "L3 vocab: missing GLOSSARY.md fails loudly" vocab

# `rules.sh vocab` delegates to the helper.
new_repo; echo 'pub fn session_id() {}' >crates/b.rs; commit x
expect fail "L3 vocab: rules.sh vocab delegates" loop/rules.sh vocab
new_repo
expect pass "L3 vocab: rules.sh vocab clean" loop/rules.sh vocab

[ "$failures" -eq 0 ] || { echo "$failures failed"; exit 1; }
