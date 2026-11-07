The plan from setup to daily use is in roundup://pad/release-plan?project=demo; the parts are here too:

1. Installer: puts the app on the Mac, because nothing else runs without it.
2. Updater: fetches new versions, so you never reinstall by hand.
3. Crash report: sends a log after a failure, so a bug reaches us once.

Saying "go" starts one build agent for the installer.
