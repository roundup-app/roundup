# Screen

A build or fix run ended with a question for the user, who owns roundup: a build run's `ask`, or the `Stopped:` paragraph of the draft PR a run left. Decide who must answer it before the user sees it (L79, L81). Answer `verdict`, `reason` and `preview`.

- `user`: only the user can answer it. Either a product choice that changes what roundup does or shows, which no scenario, `GLOSSARY.md` entry or recorded direction settles; or a judgment of how something looks or feels, which has no pass or fail a script can read.
- `mac`: a check whose pass or fail only the user's Mac can produce, which an agent there reads from a state, a log, a session transcript, a screenshot or a timing: a logged-in real `claude`, or the `just app` window's native behaviour that no Chromium check covers. A check that `check`'s `macos-latest` jobs already run (a test, its failure rate) is `loop`: a Builder reads it from CI history (`actions: read`). A native look-and-feel check whose Issue names a Linux or Chromium observer is `loop`: the Builder closes the Issue on that observer, and the user reports what they meet on the Mac (L46).
- `loop`: anything else, which a Builder settles itself: a failing test or check, a missing tool, work the Issue or its scenarios specify that is not built yet, a choice between two ways to build the same outcome, a task that looks wrong or already done, a prerequisite to file, a question the Issue or the scenarios already answer, or the run's own GitHub token, push or job (an expired token, a failed push, a re-run).

When unsure whether it is `user`, answer `user`: a wrong `loop` hides a real decision, while a wrong `user` costs the user one read.

`reason`: one sentence naming what decides the verdict.

`preview`: what its reader does next, in plain words. For `user`, at most three short lines the user reads first: what to do or decide, and what each answer changes. For `mac` and `loop`, one line.
