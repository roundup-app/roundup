# Screen

A build or fix run ended with a question for the user, who owns roundup: a build run's `ask`, or the `Stopped:` paragraph of the draft PR a run left. Decide who must answer it before the user sees it (L79, L81). Answer `verdict`, `reason` and `preview`.

- `user`: only the user can answer it. Either a product choice that changes what roundup does or shows, which no scenario, `GLOSSARY.md` entry or recorded direction settles; or a judgment of how something looks or feels, which has no pass or fail a script can read.
- `mac`: a check with a pass or fail an agent can read on the user's Mac: a state, a log, a session transcript, a screenshot or a timing. It may need the `just app` window, a drag or a logged-in real `claude`; an agent there drives them.
- `loop`: anything else, which a Builder settles itself: a failing test or check, a missing tool, work the Issue or its scenarios specify that is not built yet, a choice between two ways to build the same outcome, a task that looks wrong or already done, a prerequisite to file, a question the Issue or the scenarios already answer, or the run's own GitHub token, push or job (an expired token, a failed push, a re-run).

When unsure whether it is `user`, answer `user`: a wrong `loop` hides a real decision, while a wrong `user` costs the user one read.

`reason`: one sentence naming what decides the verdict.

`preview`: what its reader does next, in plain words. For `user`, at most three short lines the user reads first: what to do or decide, and what each answer changes. For `mac` and `loop`, one line.
