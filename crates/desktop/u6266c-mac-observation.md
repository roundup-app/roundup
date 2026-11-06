# U6266c Mac observation

U6266c: steps 1, 3 and 4 PASS; step 2 PARTIAL (the forked Agent shows in the Fork); step 2b FAIL on d64d1ee08 (Resume of a forked Agent with a real conversation shows `no acknowledgement within 10s`); step 2c PASS on 983f7eda0, which holds #6333 (the same walk resumes).
Date: 2026-11-06. Commit: d64d1ee08 (origin/main), worktree /tmp/loop-own/obs6266 with a warm target.
Live App: `just app /tmp/loop-own/obs-data/proj` with `ROUNDUP_HOME=/tmp/loop-own/obs6266-home`, `ROUNDUP_DATA_DIR=/tmp/loop-own/obs6266-data` and `ROUNDUP_CLAUDE_BIN` set to a stand-in script (the real `claude` answers its `plugin` probe; an Agent's launch only prints text). The Project is a fresh git repository with one Agent.
Driving: the menu item `Fork for development…` through `osascript` System Events; clicks through a CGEvent mouse click; windows read with `CGWindowListCopyWindowInfo`; screenshots with `screencapture -l`. `osascript` keystrokes did not reach the App, so every Fork kept the sheet's default name `fork` (the second landed in folder `fork-2`).

## Steps

| step | result |
|---|---|
| 1 Fork with no Agents (Agent unticked) | PASS. The sheet closed and a second window titled `proj — fork` existed 13 s after Make Fork. The Fork shows teal, "No Agents yet". `fork.json` holds `"agents": "none"`. The live App (PID 6966) kept running. |
| 2 Fork with all Agents, open it | PARTIAL. The Fork shows the Agent `new-agent` in its Rail (stopped, with the earlier output absent: "No output kept from an earlier run."); `fork.json` holds `"agents": "all"`. Its context menu offers no Resume: the Agent was made with the stand-in `claude` script, so it holds no saved conversation and `can_resume` is false. Resume needs an Agent that ran real Claude Code; none was made, to keep model spend off the run. |
| 3 Quit the Fork, open its `.app` from Finder | PASS. With the live App and every Fork quit, `open forks/fork-2/fork.app` (LaunchServices, no environment passed) started one process, `ROUNDUP_DATA_DIR=/tmp/loop-own/obs6266-home/forks/fork-2` and no `ROUNDUP_DEV_PORT`; its window showed Project `proj`, the teal Fork colour and the forked Agent `new-agent` in the Rail, so it opened the same Fork on the Fork's data folder, not the live App's. The `.app` is Info.plist, `fork.icns` and a `MacOS/roundup` shell script that unsets `ROUNDUP_DEV_PORT`, `ROUNDUP_SLOT`, `ROUNDUP_RUPD_BIN` and execs the binary with `ROUNDUP_DATA_DIR` set to the Fork's folder. The Dock icon and the `.app`'s name were not inspected. |
| 4 A second Fork while one runs | PASS. With Fork 1 running, Make Fork opened a second window within about 10 s of the click; three Apps then ran side by side. |

Environment of each running App, read from `ps eww` (only these three variables): live `ROUNDUP_DATA_DIR=/tmp/loop-own/obs6266-data`, dev port 5174; Fork 1 data `/tmp/loop-own/obs6266-home/forks/fork`, port 5175; Fork 2 data `.../forks/fork-2`, port 5176. No Fork inherited the live port or data folder.

## Notes

- The first click on Make Fork did not register while a Fork window sat in front of the live window; the click worked once the live App was frontmost. This is a driver issue, not a product failure.
- The live App's first Fork waited on a typed name that never arrived; the default name was used throughout.
- The first run stopped when the owner used the Mac; steps 2 and 3 were taken on a second run with the Mac idle for over 4 minutes.

## Step 2b: resume a forked Agent that holds a real Claude Code conversation

Result: FAIL. Resume is offered, but running it does not continue the conversation. The Rail shows `1: no acknowledgement within 10s` and the Agent's pane stays "No output kept from an earlier run."; neither the prompt nor "ok" shows.

Run (2026-11-06, 15:09 to 15:14, commit d64d1ee08, Mac idle over 60 s at each window step):
- Live App: `just app /tmp/loop-own/obs-data/proj` from /tmp/loop-own/obs6266, `ROUNDUP_HOME=/tmp/loop-own/obs6266c-home`, `ROUNDUP_DATA_DIR=/tmp/loop-own/obs6266c-data`, no `ROUNDUP_CLAUDE_BIN`, so the real `claude` (v2.1.316; the App's default model, Opus 5.5, was not changed). New Agent, prompt "Reply with the word ok." The Terminal showed the prompt and the reply `ok`; the Agent was named `reply-with-word`.
- `Fork for development…` with the Project and the Agent ticked (default), name `fork`. The Fork opened as `proj — fork` and its Rail holds `reply-with-word`, stopped. `fork.json` holds `"agents": "all"`.
- In the Fork, the Agent's context menu offers `Resume` (the stand-in run did not). Resume clicked.

Working folders, read from each data dir's `nodes` table (`conversation_id`, `conversation_cwd`):
| | live Agent | forked Agent |
|---|---|---|
| conversation_id | 20132b74-9233-4aac-a790-49388f7485fd | the same |
| conversation_cwd | /private/tmp/loop-own/obs-data/proj | the same |

So the Fork keeps the live Agent's working folder and conversation id; the folder is not the cause of the failure. The conversation exists at `~/.claude/projects/-private-tmp-loop-own-obs-data-proj/20132b74-....jsonl`. From that folder, `claude --resume 20132b74-... --fork-session --model haiku -p "What was my first prompt?"` answered `Your first prompt was: "Reply with the word ok."` outside the App, so the vendor can resume it.

What the Fork did: the forked Agent's `attempt` went from 1 to 2 (a launch was started), no `claude --resume` process remained, and `terminal_id` is empty. `~/.claude/projects/-private-tmp-loop-own-obs-data-proj/` gained a folder `66f96a94-5f7d-46b0-a381-470e9f3a57dc` at 15:13:02 with no matching `.jsonl`, which fits a launch with `--fork-session` that ended before it wrote a conversation. This is a lead, not a proven cause. The Fork's `logs/shell.log` is empty and holds no error text.

Not known: why the new Attempt sent no `SessionStart` within 10 s. Not checked: whether the live Agent's still-running `claude` on the same session id blocks the Fork's resume; a resume with the live App quit first would separate the two. Driver note: the first click on `Resume` only highlighted the item; a second click ran it, so the Fork may have received one resume only (one error line shows).

## Step 2c: the same walk on main with #6333 (983f7eda0)

Result: PASS. Resume in the Fork continues the conversation: the Terminal shows the prompt `Reply with the word ok.`, the reply `ok` and the Claude Code header, and no error line shows. The Rail's Agent returns to the idle circle.

Run (2026-11-06, about 17:24, Mac idle over 60 s at each window step): live App from `just app /tmp/loop-own/obs-data/proj` in a worktree at 983f7eda0, `ROUNDUP_HOME=/tmp/loop-own/obs6266d-home`, `ROUNDUP_DATA_DIR=/tmp/loop-own/obs6266d-data`, the real `claude` (App default model Opus 5.5, unchanged). New Agent, prompt "Reply with the word ok."; `Fork for development…` with the Agent ticked (default); Resume from the forked Agent's context menu (the first click only highlighted the item, the second ran it).

| | live Agent | forked Agent after Resume |
|---|---|---|
| conversation_id | 20095184-1067-4334-b818-6ce8c1e46870 | 2d62dab3-fa86-4052-a7a3-98bbb9830223 |
| conversation_cwd | /private/tmp/loop-own/obs-data/proj | the same |
| attempt | 1 | 2 (terminal_id 1) |

The forked Agent now holds a new conversation id: the resume forks the session, so the live Agent's conversation stays as it was. The new session's folder exists under `~/.claude/projects/-private-tmp-loop-own-obs-data-proj/`; no `.jsonl` for it existed at the time of the check (the run ended with no further prompt).

Not checked: a resume of a Fork whose live App was quit first (not needed for this result).

## Still open

None for #6266's Mac observer. A reader who needs the Fork's own launch output has none: the Fork's stdout was not captured.
