#!/usr/bin/env python3
"""Stands in for `claude` in the end-to-end tests.

It does only what Claude Code does that roundup can see: it runs the hook command from the
`--settings` file, and talks MCP to the `roundup` server from the `--mcp-config`
file. What it does comes from the environment, so one script serves every scenario:

  FAKE_CLAUDE_BRIEF_REPORT a file path: written with JSON {"brief": the text of the file named by
                           `--append-system-prompt-file`, "tools": the names the server lists}, as
                           the Brief and the real MCP list stand together
  FAKE_CLAUDE_ORDER_PROMPTS a legacy count of nonempty initial work lines: their complete prompts are
                           submitted and stopped, and no ASK or ON_PROMPT behaviour plays for them
  FAKE_CLAUDE_ON_PROMPT    JSON {"name", "arguments"}, or a list of them played in order (O12), a call with "skip_prompt" (a regex) not played for a prompt it matches (U146): after SessionStart (source `resume` with the id of `--resume` when started with it, U177), once per submitted prompt typed into
                           the Terminal, play UserPromptSubmit, then this tool call with "$prompt" in a
                           string argument replaced by the typed text, then Stop
  FAKE_CLAUDE_PROMPT_LOG   a file path (A32), set with FAKE_CLAUDE_ON_PROMPT: each typed prompt is appended as
                           one JSON line {"resume": whether this run has `--resume`, "prompt": the text}
  FAKE_CLAUDE_BLOCKED_LOG  a file path (B39): each typed prompt whose UserPromptSubmit hook exited 2 is appended as one
                           JSON line {"prompt": the text}; Claude Code runs no turn for it, so neither does this
  FAKE_CLAUDE_HOLD_PROMPT  a file path (B40): a typed prompt that carries Messages is logged, then its UserPromptSubmit waits until the file
                           exists, as a Daemon that is killed meanwhile never gets that Signal
  FAKE_CLAUDE_ON_PROMPT_ASK JSON {"tool_name", "tool_input"} (U166), set with FAKE_CLAUDE_ON_PROMPT: after
                           UserPromptSubmit, play this PermissionRequest ("$prompt" in a string of
                           `tool_input` replaced by the typed text) and wait for its hook command to exit;
                           the tool call is made only when the Decision was allowed
  FAKE_CLAUDE_KINDS        JSON list of "working", "error", "needs-you", "idle" or "blocked" (U351, U356): the Nth run started with no
                           `--tools` in its argv (an Agent, not a Door) acknowledges the typed startup prompt
                           after SessionStart, then plays entry N: wait for stdin to close (working), StopFailure (error), a
                           PermissionRequest waited on as FAKE_CLAUDE_ON_PROMPT_ASK does (needs-you), or Stop
                           (idle), or, for blocked (U356), a Todo made through the MCP server as a blocker and a
                           second Todo waiting on it, then Stop. A run past the list's end plays nothing. The runs are counted in files under
                           CLAUDE_CONFIG_DIR, as the runs are separate processes. Claims and exhaustion are
                           recorded in fake-claude-kind-claims.jsonl there, with pid, parent pid and argv
  FAKE_CLAUDE_GATE         a file path: after the played PermissionRequest hook command (which waits for
                           the user's answer, H9) is started, the next event waits until the file exists,
                           as the user's own act in the Terminal (H7a) happens in its own time
  FAKE_CLAUDE_DOOR_TOOLS   JSON list of {"name", "arguments"}: tools called in order on the `roundup` server (the string "$id" in an argument is the `id` of the previous result, "$ask" (U376) the `ask.to` of the last `agent_context` result), made only when this run has `--tools` in its argv (F2), as a
                           Door's has and an Agent's has not
  FAKE_CLAUDE_AGENT_TOOLS  JSON like FAKE_CLAUDE_DOOR_TOOLS, made only by the first run with no `--tools` in its argv (A26,
                           the first Agent that is not a Door); its results go to FAKE_CLAUDE_AGENT_REPORT. The
                           run that claims it is the one that creates `<FAKE_CLAUDE_AGENT_REPORT>.claimed`
  FAKE_CLAUDE_AGENT_REPORT a file path: written with the JSON list of what FAKE_CLAUDE_AGENT_TOOLS returned
  FAKE_CLAUDE_TOOL_REPORT  a file path: written with the JSON list of what each tool call returned
  "may_fail": true         in a tool call of FAKE_CLAUDE_DOOR_TOOLS, FAKE_CLAUDE_AGENT_TOOLS and
                           FAKE_CLAUDE_ON_PROMPT (H21): an error result is reported as {"error": ...}, not asserted away
  "after": "<file>"        in the same tool calls (H21): the call is made once the file exists
  FAKE_CLAUDE_HOLD_START   a file path (H21): with FAKE_CLAUDE_ON_PROMPT, SessionStart is played only once the file exists,
                           so the Agent is not idle, and takes no Message, until then
  FAKE_CLAUDE_CHILD_PROCESS / FAKE_CLAUDE_DOOR_PROCESS
                           JSON argv (H21): started as a child of this process, with the environment of the `--settings`
                           file added, by a run with no `--tools` in its argv / with it; a process below `claude`
  FAKE_CLAUDE_HELD_START   a file path (A32): created when HOLD_START blocks before SessionStart
  FAKE_CLAUDE_LAUNCH_LOG   a file path (A36, A37): each start appends one JSON line {"argv", "env"}: the arguments it was
                           started with and the ANTHROPIC_MODEL and CLAUDE_CODE_EFFORT_LEVEL it saw. The run then plays
                           SessionStart (naming the conversation `--resume` gave, else a fixed one), idles, and appends
                           each line typed into the Terminal to FAKE_CLAUDE_INPUT_LOG, when that is set
  FAKE_CLAUDE_RUN          JSON list (F2, F4): each item is run with the `env` of the `--settings` file added
                           to the environment, as Claude Code does; a string by `sh -c`, a list directly
  FAKE_CLAUDE_RUN_REPORT   a file path: written with JSON [{"code", "stdout", "stderr"}] for each run
  FAKE_CLAUDE_STRAY        a script path (F5): started as `sh <path>`, a child of this process
  FAKE_CLAUDE_MCP_STRAY    a script path (F5): a fake MCP server is started as a child of this process and
                           told to call a tool, which starts `sh <path>` under it

It then sleeps until the Daemon stops it.
"""
import json
import os
import re
import subprocess
import sys
import time


# The fake models the vendor capability probe; real loading has its own Q11 observer.
if sys.argv[1:3] == ["plugin", "test"]:
    print("Q11 runtime hook closure: 1 pass")
    sys.exit(0)


def flag(name):
    return sys.argv[sys.argv.index(name) + 1]


def run_commands():
    env = {**os.environ, **json.load(open(flag("--settings"))).get("env", {})}
    done = []
    for item in json.loads(os.environ["FAKE_CLAUDE_RUN"]):
        argv = ["sh", "-c", item] if isinstance(item, str) else item
        ran = subprocess.run(argv, env=env, capture_output=True, text=True)
        done.append({"code": ran.returncode, "stdout": ran.stdout, "stderr": ran.stderr})
    with open(os.environ["FAKE_CLAUDE_RUN_REPORT"], "w") as out:
        json.dump(done, out)


def play_mcp_stray(script):
    """A fake MCP server as a child of this process, as Claude Code starts one; its tool starts `script`."""
    server = subprocess.Popen(
        [sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "fake_mcp.py")],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
        env={**os.environ, "FAKE_STRAY": script},
    )
    server.stdin.write(json.dumps({"method": "tools/call"}) + "\n")
    server.stdin.flush()
    server.stdout.readline()
    return server


def run_hook(command, payload, blocks=False, **options):
    """Run one hook command as Claude Code does: any failure but exit 2 goes to stderr and the session goes on,
    as after a `rup signal` that timed out on a busy Daemon. Exit 2 would block, which `rup` asks for only to drop a
    prompt that repeats delivered Messages (B39), so it raises unless the caller blocks."""
    ran = subprocess.run(command, shell=True, input=payload, text=True, **options)
    if ran.returncode == 2 and not blocks:
        ran.check_returncode()
    if ran.returncode:
        sys.stderr.write(f"hook exited {ran.returncode}: {command}\n")
    return ran


BLOCKED = []


def hook(event, extra=None):
    """Play one hook event. A UserPromptSubmit that exits 2 blocks its prompt (B39): it is kept in BLOCKED."""
    command = json.load(open(flag("--settings")))["hooks"][event][0]["hooks"][0]["command"]
    payload = {"hook_event_name": event, **(extra or {})}
    ran = run_hook(command, json.dumps(payload), blocks=event == "UserPromptSubmit", stdout=subprocess.PIPE)
    if ran.returncode == 2:
        BLOCKED.append(payload["prompt"])


def split_line(pending):
    """The first typed line of `pending` and the rest; a newline inside a bracketed paste does not end it."""
    inside = False
    for at in range(len(pending)):
        if pending.startswith(b"\x1b[200~", at):
            inside = True
        elif pending.startswith(b"\x1b[201~", at):
            inside = False
        elif not inside and pending[at] in b"\r\n":
            return pending[:at], pending[at + 1 :]
    return None


def typed_prompts():
    """Submitted prompts, keeping a bracketed paste whole and excluding roundup Context from the scripted work."""
    pending = b""
    while True:
        chunk = os.read(0, 4096)
        if not chunk:
            return
        pending += chunk
        while (split := split_line(pending)) is not None:
            line, pending = split
            text = line.replace(b"\x1b[200~", b"").replace(b"\x1b[201~", b"").decode(errors="replace").strip()
            # H20: the typed lead-in of a Steer, outside the paste; the prompt is the pasted body.
            text = text.removeprefix("Follow this instruction: ")
            text = text.split("\n\n<roundup-context>\n", 1)[0]
            # The Daemon heads a Message with `[from <sender>, <kind>] `; the prompt is its body.
            text = re.sub(r"^\[[^\]]*\] ", "", text)
            if text:
                yield text


def shown(prompt):
    """The prompt as its sender wrote it, without the id line the Daemon appends (B39)."""
    head, sep, tail = prompt.rpartition("\n\n[rup messages: ")
    return head if sep and tail.endswith("]") and "\n" not in tail else prompt


def ask_permission(ask, prompt, report=None):
    """Play a PermissionRequest and wait for `rup permission` to exit; whether the Decision was allowed."""
    command = json.load(open(flag("--settings")))["hooks"]["PermissionRequest"][0]["hooks"][0]["command"]
    tool_input = {key: value.replace("$prompt", shown(prompt)) if isinstance(value, str) else value for key, value in ask.get("tool_input", {}).items()}
    payload = {"hook_event_name": "PermissionRequest", "tool_name": ask["tool_name"], "tool_input": tool_input}
    ran = run_hook(command, json.dumps(payload), stdout=subprocess.PIPE)
    received = json.loads(ran.stdout or "{}")
    if report:
        with open(report, "w") as out:
            json.dump(received, out)
    return received.get("hookSpecificOutput", {}).get("decision", {}).get("behavior") == "allow"


def play_prompts(tool):
    hold = os.environ.get("FAKE_CLAUDE_HOLD_START")
    if hold and not os.path.exists(hold) and "FAKE_CLAUDE_HELD_START" in os.environ:
        with open(os.environ["FAKE_CLAUDE_HELD_START"], "w"):
            pass
    while hold and not os.path.exists(hold):
        time.sleep(0.02)
    sys.stdout.write("\033]0;\u2733 claude\007")  # the star title that opens H19's gate, as Claude Code sets it
    sys.stdout.flush()
    if "--resume" in sys.argv:
        # U177: a reopened Door is acknowledged by a SessionStart that names the conversation it resumed.
        hook("SessionStart", {"session_id": flag("--resume"), "source": "resume"})
    else:
        hook("SessionStart", {"session_id": "00000000-0000-4000-8000-000000000146", "source": "startup"})
    orders = int(os.environ.get("FAKE_CLAUDE_ORDER_PROMPTS", "0"))
    for prompt in typed_prompts():
        if "FAKE_CLAUDE_PROMPT_LOG" in os.environ:
            with open(os.environ["FAKE_CLAUDE_PROMPT_LOG"], "a") as log:
                log.write(json.dumps({"resume": "--resume" in sys.argv, "prompt": prompt}) + "\n")
        gate = os.environ.get("FAKE_CLAUDE_HOLD_PROMPT")
        while gate and "[rup messages: " in prompt and not os.path.exists(gate):
            time.sleep(0.02)
        hook("UserPromptSubmit", {"prompt": prompt})
        if BLOCKED:
            # B39: the prompt is blocked, so no turn runs and no Stop follows.
            BLOCKED.clear()
            if "FAKE_CLAUDE_BLOCKED_LOG" in os.environ:
                with open(os.environ["FAKE_CLAUDE_BLOCKED_LOG"], "a") as log:
                    log.write(json.dumps({"prompt": prompt}) + "\n")
            continue
        if orders:
            # Older observers counted the two nonempty clarification lines separately.
            count = len([line for line in prompt.splitlines() if line.strip()])
            orders = max(0, orders - count)
            hook("Stop")
            continue
        if "FAKE_CLAUDE_ON_PROMPT_ASK" in os.environ and not ask_permission(json.loads(os.environ["FAKE_CLAUDE_ON_PROMPT_ASK"]), prompt):
            hook("Stop")
            continue
        # H21: "$decision" is the id of the `[decision <id>]` note the prompt is.
        decisions = re.findall(r"^(?:\[from [^\]]+\] )?\[decision (\w+)\]", prompt, re.MULTILINE)
        answers_decisions = "$decision" in json.dumps(tool)
        if answers_decisions and not decisions:
            hook("Stop")
            continue
        calls = [call for call in (tool if isinstance(tool, list) else [tool]) if not re.match(call.get("skip_prompt", "(?!)"), prompt)]
        if not calls:
            hook("Stop")
            continue
        for decision in decisions if answers_decisions else [""]:
            mcp_session([{**call, "arguments": {key: value.replace("$prompt", shown(prompt)).replace("$decision", decision) if isinstance(value, str) else value for key, value in call.get("arguments", {}).items()}} for call in calls])
        hook("Stop")


def claim_kind():
    """U351: the entry of FAKE_CLAUDE_KINDS for this run, the Nth to be started with no `--tools`; None past the end."""
    kinds = json.loads(os.environ["FAKE_CLAUDE_KINDS"])
    directory = os.path.join(os.environ["CLAUDE_CONFIG_DIR"], "fake-claude-kinds")
    os.makedirs(directory, exist_ok=True)
    for n, kind in enumerate(kinds):
        try:
            os.close(os.open(os.path.join(directory, str(n)), os.O_CREAT | os.O_EXCL))
        except FileExistsError:
            continue
        log_kind_claim(n, kind)
        return kind
    log_kind_claim(None, None)
    return None


def log_kind_claim(index, kind):
    record = {"index": index, "kind": kind, "pid": os.getpid(), "ppid": os.getppid(), "argv": sys.argv, "cwd": os.getcwd()}
    path = os.path.join(os.environ["CLAUDE_CONFIG_DIR"], "fake-claude-kind-claims.jsonl")
    # One append syscall keeps concurrent launches individually attributable.
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    try:
        os.write(descriptor, (json.dumps(record) + "\n").encode())
    finally:
        os.close(descriptor)


def play_kind(kind):
    sys.stdout.write("\033]0;\u2733 claude\007")  # the star title that opens H19's gate, as in play_prompts
    sys.stdout.flush()
    hook("SessionStart", {"session_id": "00000000-0000-4000-8000-000000000351", "source": "startup"})
    # H12 admits the first Steer while Idle; inventing a submission here races that admission.
    prompt = next(typed_prompts(), None)
    if prompt is None:
        return
    hook("UserPromptSubmit", {"prompt": prompt})
    if kind == "working":
        while os.read(0, 4096):
            pass
    elif kind == "error":
        hook("StopFailure", {"error": "u351"})
    elif kind == "needs-you":
        ask_permission({"tool_name": "Bash", "tool_input": {"command": "echo u351"}}, "u351", os.environ.get("FAKE_CLAUDE_AGENT_REPORT"))
    elif kind == "idle":
        hook("Stop")
    elif kind == "blocked":
        mcp_session([
            {"name": "todo_create", "arguments": {"title": "u356 blocker"}},
            {"name": "todo_create", "arguments": {"title": "u356 waiting", "blockers": ["$id"]}},
        ], None, os.devnull)
        hook("Stop")


def mcp_session(calls, report=None, results_to=None):
    config = json.load(open(flag("--mcp-config")))["mcpServers"]["roundup"]
    server = subprocess.Popen(
        [config["command"], *config["args"]],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
    )

    def send(message):
        server.stdin.write(json.dumps({"jsonrpc": "2.0", **message}) + "\n")
        server.stdin.flush()

    def request(id, method, params):
        send({"id": id, "method": method, "params": params})
        reply = json.loads(server.stdout.readline())
        assert reply["id"] == id and "error" not in reply, reply
        return reply["result"]

    request(1, "initialize", {
        "protocolVersion": "2025-06-18",
        "capabilities": {},
        "clientInfo": {"name": "fake-claude", "version": "0"},
    })
    send({"method": "notifications/initialized"})
    if report:
        names = [t["name"] for t in request(2, "tools/list", {})["tools"]]
        brief = open(flag("--append-system-prompt-file")).read()
        with open(report, "w") as out:
            json.dump({"brief": brief, "tools": names}, out)
    last = None
    asked = None
    results = []
    for n, tool in enumerate(calls):
        while tool.get("after") and not os.path.exists(tool["after"]):
            time.sleep(0.02)
        arguments = {
            key: [last if each == "$id" else each for each in value] if isinstance(value, list) else last if value == "$id" else asked if value == "$ask" else value
            for key, value in tool.get("arguments", {}).items()
        }
        result = request(10 + n, "tools/call", {"name": tool["name"], "arguments": arguments})
        if result.get("isError") and tool.get("may_fail"):
            # H21: a refusal is the thing observed; its JSON error is what the report holds.
            results.append({"error": json.loads(result["content"][0]["text"])})
            continue
        assert not result.get("isError"), result
        raw = result["content"][0]["text"]
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = raw
        last = parsed.get("id") if isinstance(parsed, dict) else None
        # U376: "$ask" in a string argument is `ask.to` of the previous `agent_context` result, the Agent that started this one.
        asked = (parsed.get("ask") or {}).get("to", asked) if isinstance(parsed, dict) else asked
        results.append(parsed)
    results_to = results_to or os.environ.get("FAKE_CLAUDE_TOOL_REPORT")
    if results_to and results:
        with open(results_to, "w") as out:
            json.dump(results, out)


def claim_agent_tools():
    report = os.environ["FAKE_CLAUDE_AGENT_REPORT"]
    try:
        os.close(os.open(report + ".claimed", os.O_CREAT | os.O_EXCL))
    except FileExistsError:
        return
    mcp_session(json.loads(os.environ["FAKE_CLAUDE_AGENT_TOOLS"]), None, report)


def log_launch():
    seen = {name: os.environ[name] for name in ("ANTHROPIC_MODEL", "CLAUDE_CODE_EFFORT_LEVEL") if name in os.environ}
    with open(os.environ["FAKE_CLAUDE_LAUNCH_LOG"], "a") as log:
        log.write(json.dumps({"argv": sys.argv[1:], "env": seen, "functionHooks": os.environ.get("CLAUDE_CODE_ENABLE_FUNCTION_HOOKS")}) + "\n")


def play_session():
    """A36, A37: SessionStart, so the Daemon saves the conversation (A21), then record what is typed."""
    sys.stdout.write("\033]0;\u2733 claude\007")
    sys.stdout.flush()
    if "--resume" in sys.argv:
        hook("SessionStart", {"session_id": flag("--resume"), "source": "resume"})
    else:
        hook("SessionStart", {"session_id": "00000000-0000-4000-8000-000000000036", "source": "startup"})
    for line in typed_prompts():
        if "FAKE_CLAUDE_INPUT_LOG" in os.environ:
            with open(os.environ["FAKE_CLAUDE_INPUT_LOG"], "a") as log:
                log.write(line + "\n")


if "FAKE_CLAUDE_LAUNCH_LOG" in os.environ:
    log_launch()
if "FAKE_CLAUDE_RUN" in os.environ:
    run_commands()
stray = [subprocess.Popen(["sh", os.environ["FAKE_CLAUDE_STRAY"]])] if "FAKE_CLAUDE_STRAY" in os.environ else []
process = os.environ.get("FAKE_CLAUDE_DOOR_PROCESS" if "--tools" in sys.argv else "FAKE_CLAUDE_CHILD_PROCESS")
if process:
    settings_env = json.load(open(flag("--settings"))).get("env", {})
    stray.append(subprocess.Popen(json.loads(process), env={**os.environ, **settings_env}))
if "FAKE_CLAUDE_MCP_STRAY" in os.environ:
    stray.append(play_mcp_stray(os.environ["FAKE_CLAUDE_MCP_STRAY"]))
if "FAKE_CLAUDE_BRIEF_REPORT" in os.environ:
    mcp_session([], os.environ["FAKE_CLAUDE_BRIEF_REPORT"])
if "FAKE_CLAUDE_DOOR_TOOLS" in os.environ and "--tools" in sys.argv:
    mcp_session(json.loads(os.environ["FAKE_CLAUDE_DOOR_TOOLS"]))
if "FAKE_CLAUDE_AGENT_TOOLS" in os.environ and "--tools" not in sys.argv:
    claim_agent_tools()
if "FAKE_CLAUDE_KINDS" in os.environ and "--tools" not in sys.argv:
    kind = claim_kind()
    if kind:
        play_kind(kind)
        time.sleep(3600)
if "FAKE_CLAUDE_ON_PROMPT" in os.environ or "FAKE_CLAUDE_PROMPT_LOG" in os.environ:
    play_prompts(json.loads(os.environ.get("FAKE_CLAUDE_ON_PROMPT", "[]")))
if "FAKE_CLAUDE_LAUNCH_LOG" in os.environ:
    play_session()
time.sleep(3600)
