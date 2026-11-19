# herdr-core missing

Modules: `crates/agents`, `apps/desktop` (the webview), `README.md`. Ids: HM7589a–HM7589c. Work order: [#7589](https://github.com/roundup-app/roundup/issues/7589). Terms: Agent, Daemon, Channel (`GLOSSARY.md`). Extends `scenarios/install-guide.md` (IG7150a, IG7150b), `scenarios/ui-failure-toasts.md` and `scenarios/ui-agent-errors.md`; their other clauses hold.

Policy: no contract, RPC method or App seam change. The README is the install path for herdr-core; Settings › Updates keeps updating it and never installs it the first time.

**HM7589a start names the missing core.** Given a computer with `claude` and no `herdr-core` on the login-shell `PATH`, when the user starts or resumes an Agent, then the Daemon refuses with a message that says herdr-core is not installed and gives the install command `curl -fsSL https://releases.herdr.dev/core/install.sh | sh`, and the toast shows that message in place of "Completion is unconfirmed. Check before trying again.", with Dismiss. Test: `hm7589a_spawn_without_herdr_core_names_it` (`crates/agents`, spawn and resume with `herdr-core` absent from `PATH`) and `hm7589a_toast_shows_the_daemon_message` (webview, a -32603 whose message names herdr-core).

**HM7589b other failures keep their copy.** Given a -32603 whose message does not name herdr-core, when the toast shows, then it keeps "Completion is unconfirmed. Check before trying again." and never repeats the Daemon's raw message. Test: `hm7589b_other_internal_errors_keep_the_fixed_copy` (webview).

**HM7589c README install.** Given `README.md`, then its Install section gives the herdr-core install command of HM7589a before opening the App, and the Stable block extracts into `~/Applications` (`mkdir -p ~/Applications`, `tar -xz -C ~/Applications`, `open ~/Applications/Roundup.app`) so it needs no admin rights; the App then updates itself there. The Dev block and its Fork command use the same folder. Policy, observer: on a Mac with no herdr-core and a user outside the `admin` group, the Install section ends in an App where `rup agent spawn` reaches idle, and no command needs `sudo`.
