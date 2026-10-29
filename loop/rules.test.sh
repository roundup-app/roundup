#!/usr/bin/env bash
# Tests for loop/rules.sh, each in a throwaway git repo. Usage: loop/rules.test.sh
# shellcheck disable=SC2016 # Fixture scripts and Markdown fences must retain literal shell syntax.
set -euo pipefail

script="$(cd "$(dirname "$0")" && pwd)/rules.sh"
failures=0

new_repo() {
  dir=$(mktemp -d)
  cd "$dir"
  git init -q -b main
  git config user.email t@t
  git config user.name t
  mkdir loop crates contracts
  cp "$script" loop/rules.sh
  printf '| Code term | User label | Avoid |\n|---|---|---|\n| Agent | Agent | session, bot, process |\n| Lead | Lead | parent agent |\n| Run | Run | — |\n' >GLOSSARY.md
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

rules() { loop/rules.sh "$1"; }

# L98
workflows="$(dirname "$script")/../.github/workflows"
pipefail_everywhere() {
  local w
  for w in "${1:-$workflows}"/*.yml; do
    [ "$(grep -A2 -x 'defaults:' "$w" | tr -d ' \n')" = defaults:run:shell:bash ] || return 1
  done
}
expect pass 'L98 every workflow runs its steps under bash -eo pipefail' pipefail_everywhere

# L84
expect pass 'L84 the gate needs the mac lane and never main'"'"'s linux job' bash -c "gate=\$(sed -n '/^  check:/,/^  summary:/p' '$workflows/check.yml'); grep -qE 'needs: \\[.*(\\[| )mac(,|\\])' <<<\"\$gate\" && ! grep -qE 'needs: \\[.*linux' <<<\"\$gate\""

# vocab
new_repo
expect pass "L3 vocab: clean" rules vocab
for decl in 'pub fn session_id() {}' 'pub const fn session_id() {}' 'pub struct Sessions;' 'pub struct S {\n    pub session: u8,\n}' 'pub(crate) fn bot() {}' 'pub fn parent_agent() {}' 'pub fn list_processes() {}'; do
  new_repo; printf '%b\n' "$decl" >crates/b.rs; commit x
  expect fail "L3 vocab: $decl" rules vocab
done
new_repo; mkdir -p crates/agents/src/claude_code; echo 'pub fn session_id() {}' >crates/agents/src/claude_code/a.rs; commit x
expect pass "L3 vocab: claude_code adapter is exempt" rules vocab
new_repo; mkdir -p crates/other/claude_code; echo 'pub fn session_id() {}' >crates/other/claude_code/a.rs; commit x
expect fail "L3 vocab: another claude_code dir is not exempt" rules vocab
new_repo; echo 'export type SessionId = string;' >contracts/a.ts; commit x
expect fail "L3 vocab: TS export" rules vocab
new_repo; rm GLOSSARY.md; echo 'pub fn session_id() {}' >crates/b.rs; commit x
expect fail "L3 vocab: missing GLOSSARY.md fails loudly" rules vocab
new_repo; printf '| Code term | User label | Avoid |\n|---|---|---|\n| Agent | Agent | — |\n' >GLOSSARY.md; echo 'pub fn session_id() {}' >crates/b.rs; commit x
expect fail "L3 vocab: a table with no Avoid data fails loudly" rules vocab

# L95
words() { loop/rules.sh architect-words; }
new_repo; mkdir scenarios docs; echo 'Contract change (architect-approved).' >scenarios/a.md; commit x
expect fail 'l95_a_role_mention_fails_naming_file_and_line' words
[ "$(loop/rules.sh architect-words 2>&1 || true)" = scenarios/a.md:1 ] || { echo 'FAIL: l95 names file:line'; failures=$((failures + 1)); }
new_repo; mkdir scenarios docs; printf '%s\n' 'Branch `architect/u22-drag-tdd`, architect-swarm, architect-b and architect-c.' "architect-swarm's Mac" >docs/a.md; commit x
expect pass 'l95_branch_and_host_names_pass' words
new_repo; mkdir scenarios docs; echo 'See .agents/architect.md.' >docs/a.md; commit x
expect fail 'l95_a_cited_architect_prompt_fails' words
new_repo; mkdir scenarios docs; echo 'architect-bound' >docs/a.md; commit x
expect fail 'l95 architect-bound is not a host name' words
new_repo; mkdir scenarios docs; printf '%s\n' '**L95 Architect sweep.** the Architect' 'architect-approved' 'Tests: x' >scenarios/a.md; commit x
expect pass 'l95 the L95 block is exempt' words
new_repo; mkdir scenarios docs; printf '%s\n' '**L95 Architect sweep.** x' 'Tests: x' 'the architect' >scenarios/a.md; commit x
expect fail 'l95 a line after the Tests line is not exempt' words
outside=$(mktemp -d); mkdir "$outside/loop"; cp "$script" "$outside/loop/rules.sh"
got=0; "$outside/loop/rules.sh" architect-words >/dev/null 2>&1 || got=$?
[ "$got" = 2 ] || { echo "FAIL: l95 outside a checkout exits 2 (got $got)"; failures=$((failures + 1)); }

# delta
expect_exit() {
  local want=$1 name=$2 got=0 out
  shift 2
  out=$("$@" 2>&1) || got=$?
  if [ "$got" != "$want" ]; then echo "FAIL: $name (wanted exit $want, got $got): $out"; failures=$((failures + 1)); else echo "ok:   $name"; fi
}

expect_output() {
  local want=$1 name=$2 got
  shift 2
  got=$("$@" 2>/dev/null || true)
  if [ "$got" != "$want" ]; then echo "FAIL: $name (got: $got)"; failures=$((failures + 1)); else echo "ok:   $name"; fi
}

# A checks file with every id D1 to D14 passing, except the ids given as Dn=status.
write_checks() {
  local file=$1
  shift
  mkdir -p "$(dirname "$file")"
  jq -n '[range(1;15) | "D\(.)"] as $ids
    | ($ARGS.positional | map(split("=") | {(.[0]): .[1]}) | add // {}) as $set
    | $ids | map({(.): {status: ($set[.] // "pass"), value: 1, selector: "x"}}) | add' --args "$@" >"$file"
}

delta() { "$script" delta "$@"; }
new_dirs() { dir=$(mktemp -d); cd "$dir"; mkdir base head; }

new_dirs; write_checks base/s.checks.json; write_checks head/s.checks.json
expect_exit 0 "L42 delta: nothing changed" delta base head
expect_output "$(for n in 1 2 3 4 5 6 7 8 9 10 11 12 13 14; do echo "s D$n still-passing"; done)" "L42 delta: one line per check, ordered by id" delta base head
new_dirs; write_checks base/s.checks.json D3=fail; write_checks head/s.checks.json
expect_output "s D3 fixed" "L42 delta: fail then pass is fixed" bash -c "'$script' delta base head | grep D3"
expect_exit 0 "L42 delta: a fixed check passes" delta base head
new_dirs; write_checks base/s.checks.json; write_checks head/s.checks.json D6=fail
expect_output "s D6 regressed" "L42 delta: pass then fail is regressed" bash -c "'$script' delta base head | grep D6"
expect_exit 1 "L42 delta: a regressed check exits 1" delta base head
new_dirs; write_checks base/s.checks.json D2=fail; write_checks head/s.checks.json D2=fail
expect_output "s D2 still-failing" "L42 delta: fail then fail is still-failing" bash -c "'$script' delta base head | grep D2"
expect_exit 0 "L42 delta: a still-failing check passes" delta base head
new_dirs; write_checks base/L1/a.checks.json; write_checks head/L1/a.checks.json; write_checks base/L1/b.checks.json; write_checks head/L1/b.checks.json
expect_output "L1/a L1/b" "L42 delta: steps are paths without the suffix, ordered" bash -c "'$script' delta base head | awk '{print \$1}' | uniq | tr '\n' ' ' | sed 's/ \$//'"
new_dirs; write_checks base/s.checks.json; write_checks head/s.checks.json; write_checks base/only.checks.json
expect_exit 2 "L42 delta: a step on one side only exits 2" delta base head
new_dirs; write_checks base/s.checks.json; write_checks head/s.checks.json; jq 'del(.D4)' head/s.checks.json >head/t && mv head/t head/s.checks.json
expect_exit 2 "L42 delta: a missing check id exits 2" delta base head
new_dirs; write_checks base/s.checks.json; write_checks head/s.checks.json D5=maybe
expect_exit 2 "L42 delta: a status that is neither pass nor fail exits 2" delta base head
new_dirs; write_checks base/s.checks.json; echo 'not json' >head/s.checks.json
expect_exit 2 "L42 delta: a file that is not JSON exits 2" delta base head
new_dirs
expect_exit 2 "L42 delta: no checks files exits 2" delta base head
expect_exit 2 "L42 delta: a directory that does not exist exits 2" delta base nope

# L54 clean-merge: a throwaway repo with `origin/main` and a PR branch.
merge_repo() {
  new_repo
  git checkout -q main
  mkdir -p scenarios && echo a >scenarios/loop.md
  commit queue 'Author-Agent: t'
  git update-ref refs/remotes/origin/main HEAD
  git checkout -q -b pr
  echo work >work.txt
  commit work 'Author-Agent: t'
}
# main_commit <file> <content>: advance origin/main on its own branch, then come back to pr.
main_commit() {
  git checkout -q main && printf '%s' "$2" >"$1" && git add -A && git commit -qm "main change" -m "Author-Agent: t" && git update-ref refs/remotes/origin/main HEAD && git checkout -q pr
}
# merge_main: merge origin/main into pr; the caller resolves a conflict by writing the file, then calls finish_merge.
merge_main() { git merge -q --no-commit --no-ff origin/main >/dev/null 2>&1 || true; }
finish_merge() { git add -A && git commit -qm "Merge main" -m "${1-}"; }
# L120 merge-loss: own files come from the branch's non-merge commits, never from a PR body.
loss_code() {
  local want=$1 name=$2 why=${3:-} got=0 out
  out=$(loop/rules.sh merge-loss 2>&1) || got=$?
  if [ "$got" -eq "$want" ] && [[ $out == *"$why"* ]]; then echo "ok:   $name"; else echo "FAIL: $name (wanted exit $want, got $got: $out)"; failures=$((failures + 1)); fi
}
merge_repo; loss_code 0 "L120 a branch whose changed files are all its own commits' passes"
merge_repo; git rm -q scenarios/loop.md; commit "remove it" 'Author-Agent: t'
loss_code 0 "L120 a deletion made in an own commit passes"
merge_repo; main_commit scenarios/loop.md changed; merge_main; echo a >scenarios/loop.md; finish_merge
loss_code 1 "L120 a merge that drops a main hunk in an untouched file fails, listing it" "scenarios/loop.md"
merge_repo; main_commit other.txt x; merge_main; finish_merge; main_commit scenarios/loop.md later
loss_code 0 "L120 a file main changed after the branch's last merge of main passes"

# L41
src_repo() { new_repo; mkdir -p apps/desktop/src/rail apps/desktop/src/terminal apps/desktop/src/testing; }
tokens_with() { src_repo; printf '%b\n' "$2" >"apps/desktop/src/$1"; commit x; }
tokens_out() { loop/rules.sh tokens 2>&1 || true; }
tokens_says() { [ "$(tokens_out)" = "$1" ]; }
tokens_pass() { [ -z "$(tokens_out)" ] && loop/rules.sh tokens; }
tokens_fail() { ! loop/rules.sh tokens >/dev/null 2>&1; }
tokens_fail_all() { local f=$1 d; shift; for d in "$@"; do tokens_with "$f" "$d"; tokens_fail || return 1; done; }
tokens_pass_all() { local f=$1 d; shift; for d in "$@"; do tokens_with "$f" "$d"; tokens_pass || return 1; done; }

tokens_with rail/a.css '.a {\n  margin: 0;\n  color: #fff;\n}'
expect pass 'l41_a_hex_colour_fails_naming_file_line_and_property' tokens_says 'apps/desktop/src/rail/a.css:3 color'
expect pass 'l41_rgba_hsl_and_a_bare_colour_name_fail' tokens_fail_all rail/a.css '.a { background: rgba(0,0,0,.5); }' '.a { fill: hsl(0 0% 0%); }' '.a { border: 1px solid red; }' '.a { outline-color: oklch(0.5 0 0); }'
expect pass 'l41_a_unit_font_size_and_radius_fail' tokens_fail_all rail/a.css '.a { font-size: 12px; }' '.a { border-radius: 50%; }'
expect pass 'l41_a_box_shadow_and_a_duration_fail' tokens_fail_all rail/a.css '.a { box-shadow: 0 1px 2px #000; }' '.a { box-shadow: 0 1px 2px; }' '.a { transition: color 120ms; }' '.a { animation-duration: .2s; }'
expect pass 'l41_var_reads_pass' tokens_pass_all rail/a.css '.a { color: var(--text); border: 1px solid var(--hairline); font-size: var(--size); box-shadow: var(--shadow); transition: color var(--dur); }'
expect pass 'l41_transparent_inherit_currentcolor_none_and_0s_pass' tokens_pass_all rail/a.css '.a { background: transparent; color: inherit; fill: currentColor; border: none; box-shadow: none; transition: color 0s; }'
tokens_with tokens.css ':root { --text: #1d1d1f; font-size: 12px; box-shadow: 0 0 1px red; transition: 1s; }'
expect pass 'l41_tokens_css_is_not_read' tokens_pass
src_repo; echo 'const o = { fontSize: 12 };' >apps/desktop/src/terminal/emulator.ts; echo '.a { color: #fff; }' >apps/desktop/src/testing/a.css; echo 'x = <b style={{ color: "red" }} />;' >apps/desktop/src/rail/a.test.tsx; commit x
expect pass 'l41_emulator_ts_and_test_files_are_not_read' tokens_pass
tokens_with rail/a.tsx 'const a = <b style={{ color: "var(--text)", fontSize: "var(--s)" }} />;'
tokens_pass_ok=$(tokens_pass && echo y || echo n)
tokens_with rail/a.tsx 'const a = (\n  <b style={{ color: "var(--text)", borderRadius: "4px" }} />\n);'
expect pass 'l41_an_inline_style_literal_fails_and_a_var_passes' bash -c "[ '$tokens_pass_ok' = y ] && [ \"\$(loop/rules.sh tokens 2>&1)\" = 'apps/desktop/src/rail/a.tsx:2 borderRadius' ]"
tokens_with rail/a.css '/* color: #fff; */\n.a { color: var(--x); /* font-size: 12px */ }'
comment_css=$(tokens_pass && echo y || echo n)
tokens_with rail/a.tsx '// <b style={{ color: "red" }} />\nconst a = 1;'
expect pass 'l41_a_literal_in_a_comment_passes' bash -c "[ '$comment_css' = y ] && loop/rules.sh tokens"
expect_exit 2 'l41_an_argument_exits_2' loop/rules.sh tokens x

# Y3 the laws sheet
laws_repo() { new_repo; mkdir -p scenarios tests; printf '**A1 one.** text\n%s\n' "$1" >scenarios/a.md; echo 'it("a1_works", () => {});' >tests/a.test.ts; commit x; }
laws_repo 'Law: Things hold. Check: a1_'
expect pass 'y3_a_law_with_a_matching_test_prints_one_line' bash -c "[ \"\$(loop/rules.sh laws)\" = 'A1 | Things hold | a1_' ]"
laws_repo 'Law: Things hold.'
expect fail 'y3_a_law_with_no_check_exits_1' loop/rules.sh laws
expect pass 'y3_a_law_with_no_check_prints_unchecked' bash -c "loop/rules.sh laws 2>/dev/null | grep -q 'A1 | Things hold | unchecked'"
laws_repo 'Law: Things hold. Check: z9_'
expect fail 'y3_a_check_naming_a_prefix_no_test_has_exits_1' loop/rules.sh laws
expect pass 'y3_that_exit_names_the_id' bash -c "loop/rules.sh laws 2>&1 | grep -q 'A1 names'"
laws_repo $'**A2176a two.** t\nLaw: Things hold. Check: a2176a_'; echo 'it("a2176a_works", () => {});' >tests/a.test.ts; commit y
expect pass 'y3_a_lettered_heading_owns_its_law' bash -c "[ \"\$(loop/rules.sh laws)\" = 'A2176a | Things hold | a2176a_' ]"
new_repo
expect_exit 4 'y3_a_missing_scenarios_directory_exits_4' loop/rules.sh laws

# L97 unique scenario ids
ids_repo() { new_repo; mkdir scenarios; }
ids_repo
printf '**X1 one.** a\n' >scenarios/a.md; printf '**X1 again.** b\n' >scenarios/b.md
expect fail 'l97_two_files_with_one_id_fail' loop/rules.sh scenario-ids
expect pass 'l97_the_exit_names_both_places' bash -c "loop/rules.sh scenario-ids | grep -qx 'X1 scenarios/a.md:1 scenarios/b.md:1'"
ids_repo
printf '**X1 one.** a\n\n**X1 two.** b\n' >scenarios/a.md
expect fail 'l97_two_headings_in_one_file_fail' loop/rules.sh scenario-ids
ids_repo
printf '**X1 one.** a\n**X1a part.** b\n**X2176a one.** c\n' >scenarios/a.md; printf '**X2 two.** see **X1 \n**X2176b two.** d\nX1 (amended)\n- **X2 not a heading start\n' >scenarios/b.md
expect pass 'l97_distinct_ids_pass' loop/rules.sh scenario-ids
ids_repo
printf '**X1 one.** a, and X1 again\nX1 (amended clause)\n' >scenarios/a.md
expect pass 'l97_a_mention_is_not_a_heading' loop/rules.sh scenario-ids
new_repo
expect_exit 2 'l97_outside_a_checkout_exits_2' loop/rules.sh scenario-ids
expect pass 'l97_main_passes' bash -c "cd '$(cd "$(dirname "$script")/.." && pwd)' && loop/rules.sh scenario-ids"

# L34 Issue queue behavior is exercised by loop/orders.test.py.

[ "$failures" -eq 0 ] || { echo "$failures failed"; exit 1; }
