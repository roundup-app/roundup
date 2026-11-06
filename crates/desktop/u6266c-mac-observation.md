# U6266c Mac observation

U6266c: PARTIAL. Steps 1 and 4 passed; step 2 ran up to the forked Agent appearing in the Fork; step 3 and the resume of step 2 did not run (the owner began using the Mac, so the run stopped).
Date: 2026-11-06. Commit: d64d1ee08 (origin/main), worktree /tmp/loop-own/obs6266 with a warm target.
Live App: `just app /tmp/loop-own/obs-data/proj` with `ROUNDUP_HOME=/tmp/loop-own/obs6266-home`, `ROUNDUP_DATA_DIR=/tmp/loop-own/obs6266-data` and `ROUNDUP_CLAUDE_BIN` set to a stand-in script (the real `claude` answers its `plugin` probe; an Agent's launch only prints text). The Project is a fresh git repository with one Agent.
Driving: the menu item `Fork for development…` through `osascript` System Events; clicks through a CGEvent mouse click; windows read with `CGWindowListCopyWindowInfo`; screenshots with `screencapture -l`. `osascript` keystrokes did not reach the App, so every Fork kept the sheet's default name `fork` (the second landed in folder `fork-2`).

## Steps

| step | result |
|---|---|
| 1 Fork with no Agents (Agent unticked) | PASS. The sheet closed and a second window titled `proj — fork` existed 13 s after Make Fork. The Fork shows teal, "No Agents yet". `fork.json` holds `"agents": "none"`. The live App (PID 6966) kept running. |
| 2 Fork with all Agents, open it | PASS up to the Rail: the Fork shows the Agent `new-agent` in its Rail; `fork.json` holds `"agents": "all"`. Resume of that Agent was not run. |
| 3 Quit the Fork, open its `.app` from Finder | NOT RUN. The `.app` was written (`forks/fork/fork.app`: Info.plist, `fork.icns`, a `MacOS/roundup` shell script that unsets `ROUNDUP_DEV_PORT`, `ROUNDUP_SLOT`, `ROUNDUP_RUPD_BIN` and execs the binary with `ROUNDUP_DATA_DIR` set to the Fork's folder), but it was never opened. |
| 4 A second Fork while one runs | PASS. With Fork 1 running, Make Fork opened a second window within about 10 s of the click; three Apps then ran side by side. |

Environment of each running App, read from `ps eww` (only these three variables): live `ROUNDUP_DATA_DIR=/tmp/loop-own/obs6266-data`, dev port 5174; Fork 1 data `/tmp/loop-own/obs6266-home/forks/fork`, port 5175; Fork 2 data `.../forks/fork-2`, port 5176. No Fork inherited the live port or data folder.

## Notes

- The first click on Make Fork did not register while a Fork window sat in front of the live window; the click worked once the live App was frontmost. This is a driver issue, not a product failure.
- The live App's first Fork waited on a typed name that never arrived; the default name was used throughout.
- The observation stopped when another application (not this run's) came to the front and the owner was using the Mac. All three Apps, their `just` and Vite processes were stopped; nothing of the owner's was touched.

## Still open

Step 2's resume and step 3 (the `.app` from Finder opening the same Fork with its own name, colour, icon and data folder) need a run on an idle Mac.
