# Unfinished Decision answers

Isolated headless Chromium, fresh agent-browser profile, 1512×950, light scheme. Baseline: `e95acabeb` (`origin/main`). Head: `build/unfinished-decisions`. These captures observe the App over the fake Decision harness; real-Daemon delivery and lifecycle observers are in `testing/u144_real_daemon.test.tsx`.

| Before | After | Purpose |
| --- | --- | --- |
| Single-line note; an Agent switch loses the form | Multiline note, choice and caret return to the captured Prompt | Preserve unfinished work without sending it |
| No retention warning or recovery from the form | Project/Decision warning and Project-local recovery | Keep complete in-memory work when storage fails |

`native-edit.json` and `native-restored.json` record the exact text and backward selection before/after real pointer navigation, with zero `decision.answer` calls. Native Shift+Enter inserts the recorded newline.

`base/answer.png` and `head/answer.png` show the normal form. The retention-failure captures use four long answers, a long question and a 2,000-character note. The head throws only draft-storage writes; the warning remains visible and the note stays in memory. Main has no Decision draft storage, so its corresponding baseline has no retention warning.

Every recorded Check passes. `loop/rules.sh delta artifacts/ux/U2773-decisions/base artifacts/ux/U2773-decisions/head` reports no regression. D2/D5/D6 cover the changed field and actionable failure state. No native macOS or real-vendor observation is claimed.
