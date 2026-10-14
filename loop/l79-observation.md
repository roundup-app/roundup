# L79 observation

2026-10-14, Linux. `loop/screen.test.sh` passes its seven cases; `loop/screen.test.sh --live` runs the actual no-tools `claude-haiku-5-5` screen, then routes its response with recorded GitHub delivery.

[The full paragraph](l79-native-window.txt) is #1536's `Stopped:` paragraph at `88a658e24029121600ed888f9c0f65ceec686937`, preserved in [its needs-user comment](https://github.com/saadshahd/roundup/pull/1536#issuecomment-6156986567). It includes the observer link and readiness recommendation. [The live response and all calls](l79-screen-observation.json) record classification as `loop`, a PR body edit removing `Stopped:`, the matching PR comment and an `unfinished` fix dispatch. There are no label calls on either PR or Issue.

```text
#1536 paragraph → actual Haiku: loop → resumed draft → unfinished fix
```

The shell cases repeat routing with `user` and `mac` responses, a failed process, unavailable executable, timeout, malformed JSON, missing output and unknown/incomplete verdicts. Each native-only case records no waiting label, resumes the draft and retains the screen failure in its repair reason. Mixed product and logged-in real `claude` questions retain their respective routes; without a verdict, only those separate questions reach the user unscreened. Stale native previews are excluded. Look-and-feel wording, same-line questions, reversed question order and a product choice about the native window are covered.

After #1582 merged, `rg -n "PR's head" scenarios/` finds specification/review/loop head checks and L79's own search instruction, with no native window observer. The Spec recipe guard and the Builder/screen prompt agreement are executable regressions.
