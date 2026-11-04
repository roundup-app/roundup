#!/usr/bin/env bash
# L2, L23: stamp authored commits in a disposable Builder checkout before the model runs.
set -euo pipefail
[[ ${1:-} =~ ^[A-Za-z0-9_.-]+$ ]] || { echo 'expected an Author-Agent id' >&2; exit 2; }
: "${RUNNER_TEMP:?requires a disposable runner directory}"
hooks=$(mktemp -d "$RUNNER_TEMP/roundup-author.XXXXXX")
printf '#!/usr/bin/env bash\nset -euo pipefail\ngit interpret-trailers --in-place --if-exists doNothing --trailer %q "$1"\n' "Author-Agent: $1" >"$hooks/prepare-commit-msg"
# L82: and the repository's own pre-commit hook (`lefthook.yml`), so its safe lint fixes enter a Builder's commits too.
cat >"$hooks/pre-commit" <<'EOF'
#!/usr/bin/env bash
# A merge commit brings main's changes, which no Builder wrote; it commits as before.
[ ! -e "$(git rev-parse --git-path MERGE_HEAD)" ] || exit 0
[ -x node_modules/.bin/lefthook ] || { echo 'pre-commit: this worktree has no node_modules; run pnpm install' >&2; exit 1; }
exec node_modules/.bin/lefthook run pre-commit
EOF
chmod +x "$hooks/prepare-commit-msg" "$hooks/pre-commit"
git config --local core.hooksPath "$hooks"
