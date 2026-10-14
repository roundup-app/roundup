# Capture publication (L112)

For an Observer requiring captures, run `just capture <ids>` with only ids on `Scenarios:`. Keep its assertions, viewports, seeds, schemes, conditions and journey partitions. A specification-only PR needs no captures. Payloads keep their artifact-relative paths; tracked additions or edits under `artifacts/`, `crates/rpc/r16/` and `crates/rupd/evidence/` fail `rules`. Deletion alone is allowed for retirement. Directory removal is #1651; QA publication is #1613.

After the final commit, write a JSON manifest to the absolute path returned by `git rev-parse --path-format=absolute --git-path capture-observers.json` in the observing worktree. It contains the pushed PR head and one result row per observer:

```json
{"revision":"<full PR head>","observers":[{"ids":["U361"],"command":"just capture U361","exit_code":0,"conditions":"ROUNDUP_CAPTURES=U361; headless Chromium; 1280x800; light and dark; tree-40","paths":["artifacts/ux/U361/head/view.png","artifacts/ux/U361/head/view.checks.json"]}]}
```

List every payload file, including baseline captures; each path under `artifacts/ux/` belongs to a listed id, with journey ids under `artifacts/ux/journey/<id>/`. Every listed id is cited. The artifact manifest is at most 1 MiB; command and conditions each at most 2048 characters. Record the actual exit code; a nonzero observer is a failure, never publication success. No links or symlinks enter the payload.

Keep the PR draft while publication is pending. For required evidence outside desktop source, add `Capture required: <ids>` to the body. When engineering and `just check` are complete, add `Capture ready: <full PR head>`; the build/fix workflow then publishes and calls main's `ready` only after upload validation. A run with unfinished engineering leaves that line out. With an already published artifact, run `loop/rules.sh captures <pr>` before `just ready <pr>`.

Main's publication steps find the observing worktree by the pushed head, validate the manifest and stage only listed files. Stock `actions/upload-artifact@v4` uploads `captures-<head>` with `retention-days: 14` and `if-no-files-found: error`. Main's `capture-publish` verifies the downloadable archive, appends its metadata and download link to the PR body's `Capture publication:` JSON line, and keeps any failed preparation/upload/publication draft with the failure visible. It posts no verdict or passing status. `check`, `rules`, independent `review` and `critic` still decide merge on that head.

The PR's publication line holds `revision`, observer facts (`ids`, `command`, `exit_code`, `conditions`; payload paths remain in the artifact manifest), `url` (the head-specific GitHub Actions artifact download), and `retention_days: 14`. Required captures remain downloadable before review. After expiry, a committed UTF-8 Markdown summary of at most 16 KiB per observer retains result rows and the regeneration command; it must say the link expired, and cannot replace required captures before review. Link summaries and artifacts, never retiring committed payloads. Historical paths in scenarios/docs are artifact-relative; their assertions remain in the cited source and tests.
