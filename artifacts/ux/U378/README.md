# U378

```text
+ Agent → Project defaults
▾ → Model + Effort → Add agent
                   Esc → discard choices
failed add → keep pair + error → retry
failed Project defaults read → Retry → Add agent
```

Head implementation: `fbff1f6e`; rendered main baseline: `b5b51f34`. The subsequent merge of `0698c9f1` changes loop checks only. After merging main `5eb95143`, the combined head passes `just check`: 1,592 Rust tests, proofs and 2,792 web tests (4 skipped), with lint, typechecking and slop passing.

`just capture U378` refreshed first-run, agents-10 and tree-40 at 1280×800 and 1440×800, light and dark. Closed, open, changed pair and failed add use 20 Models with 40-character labels. Tree-40 also focuses backend, auth-refactor and a third-level schema-migration Workstream. All 60 head readings pass every design Check. The comparison test preserves every Check passing on main in closed and failed states.

At the default 288 px Rail, compact controls preserve Open folder, the leading 16 px list inset, the scrollbar and the full focus ring. The split occupies the original add target's width through 360 px; each half keeps a 24 px hit height. Clear, Open folder, Open in editor and the stopped Door retain U426's 24 px squares. Focused names retain at least 88, 60 and 32 px at depths one, two and three, with no horizontal overflow. A rendered assertion also verifies every non-add action remains a 24 px square. The list's compact breakpoint remains 252 px.

The final standalone `VITEST_MAX_WORKERS=2 just capture U378` passes all 2,785 web tests (4 skipped). Rust: 1,592 tests and proofs pass; lint, typechecking and slop pass.

The 65 focused U378/U426 tests pass, including unconditional Open folder Tab/Space coverage at 288 and 360 px, picker defaults and explicit/null spawn parameters, Escape focus, failed-add retry, Project-defaults retry and U392 composing guards. U378's 15 rendered tests also pass during capture, including comparisons against main.

Isolated headless agent-browser session `builder-38421028990` inspected tree-40 at 1280×800, including `Default (Sonnet)` and `Default (Medium)` in the open picker. Every design Check passed. The session used a fresh temporary profile and was closed after observation. Chromium tests use fresh profiles; no native Mac observation is claimed or required by U378. The real-Daemon Model launch observers remain A36/A37/M12's tests.
