# Claude Code commit attribution

Acceptance for #5939. Ids: G5939a, G5939b. Specification only; implementation changes `.claude/settings.json` after this acceptance merges.

## Checks on main

1. `.agents/data/pr.md`, **Commits and branches**: every authored commit carries an `Author-Agent:` trailer in its final trailer block.
2. `AGENTS.md`, **Rules**, rule 10: a test that asserts only a copied configuration value earns no place.
3. `loop/builder.py`, `claude` and `stream`: Claude Code starts with `-p` and inherits the checkout working directory; no launcher change is needed.

## Acceptance

**G5939a Claude Code adds no commit co-author attribution.** Given a new Claude Code session started in this checkout, including a Builder or fix run, when it creates a commit, then it adds no automatic `Co-Authored-By` trailer naming Claude or `noreply@anthropic.com` (policy). Set `.claude/settings.json` to contain `"attribution": {"commit": ""}` while preserving every existing setting (policy). This uses Claude Code's project configuration, so it also applies to the owner's sessions in this checkout; it does not change other projects or user-global settings (policy).

Observer (policy): parse the implementation head's `.claude/settings.json` as JSON and compare it with its base: `attribution.commit` is the empty string, and removing that added member yields the base object. Review the implementation diff and the [vendor's `attribution.commit` reference](https://code.claude.com/docs/en/settings-reference#attribution-commit), which defines the empty string as disabling commit attribution, and [project settings scope](https://code.claude.com/docs/en/settings#settings-files-and-who-they-affect). The existing vendor capability is the implementation; add no custom trailer filter, test, hook or check. A live Claude invocation is not required to verify this configuration change.

**G5939b Explicit author trailers remain.** Given an owner-supplied `Co-authored-by` trailer or a required `Author-Agent:` trailer, when this setting is introduced and subsequent commits are authored, then the owner's explicit co-author trailer remains as supplied and `Author-Agent:` remains required by Check 1 (policy). Suppressing Claude Code's automatic attribution neither strips explicit trailers nor rewrites existing commits (policy).

Observer (policy): review the implementation diff for only the added setting; inspect implementation commits with `git log --format=%B origin/main..HEAD` for their `Author-Agent:` trailer and absence of automatic Claude co-author attribution. The setting controls vendor-generated attribution, not explicit owner text. Preserve `.agents/data/pr.md`, `loop/`, `.agents/` and all existing checks; the owner's separate history rewrite is outside this work (policy). No new regression test is ordered (Check 2).

## Verification

For this specification, run `loop/rules.sh vocab`, `loop/rules.sh scenario-ids` and `python3 loop/orders.py check <issue-body-file>`. Each exits 0; report any failure and its exit code on #5939. The implementation run uses the policy observers above and the Builder's existing lint gates. There is no product behavior change and no applicable `PRINCIPLES.md` gate.
