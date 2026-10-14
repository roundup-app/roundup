#!/usr/bin/env bash
# Re-runs the spike's checks against the real claude and a local fake Messages API.
#   bash run.sh            all checks but c5slow (about 2 min)
#   bash run.sh c1 c5 ...  only these; c5slow waits out claude's default retries (about 3 min)
# Each check writes its logs under logs/<check>/ and prints a timeline (show.py).
# Never edit this file while it runs: bash reads it as it goes.
set -u
source /tmp/fake-claude-research/spike/env.sh
cd "$SPIKE"
mkdir -p work

fresh() { # NAME: a fresh log dir and config dir; sets LOG and CFG
  LOG=$SPIKE/logs/$1 CFG=$SPIKE/cfg/$1
  rm -rf "$LOG" "$CFG"
  mkdir -p "$LOG" "$CFG"
}

wait_for() { # FILE PATTERN SECONDS: until FILE holds a line matching PATTERN; fails loud on timeout
  local deadline=$(($(date +%s) + $3))
  until grep -q -- "$2" "$1" 2>/dev/null; do
    [ "$(date +%s)" -ge "$deadline" ] && { echo "TIMEOUT waiting for '$2' in $1"; return 1; }
    sleep 0.05
  done
}

seed_config() { # CONFIG_DIR: onboarding done, theme set, work folder trusted, mock key approved
  python3 - "$1" "$KEY" "$("$CLAUDE_BIN" --version | cut -d' ' -f1)" <<'PY'
import json, sys
config, key, version = sys.argv[1:]
work = "/tmp/fake-claude-research/spike/work"
json.dump({
    "hasCompletedOnboarding": True,
    "theme": "dark",
    "lastOnboardingVersion": version,
    "customApiKeyResponses": {"approved": [key[-20:]], "rejected": []},
    # Each of these, unset, shows a one-time notice or dialog that eats the first keystrokes
    # (hasSeenAutoDefaultNudge offers auto mode and rewrites settings.json on Enter).
    "lastReleaseNotesSeen": version,
    "hasSeenAutoDefaultNudge": True,
    "hasResetAutoModeOptInForDefaultOffer": True,
    "hasSeenAutoModeEntryWarning": True,
    "projects": {work: {"hasTrustDialogAccepted": True}, "/private" + work: {"hasTrustDialogAccepted": True}},
}, open(f"{config}/.claude.json", "w"))
PY
}

TMUX_CMD=(tmux -L spike -f /dev/null)
screen() { "${TMUX_CMD[@]}" capture-pane -p -t spike; }

count() { # FILE PATTERN
  local n; n=$(grep -c -- "$2" "$1" 2>/dev/null)
  echo "${n:-0}"
}

wait_count() { # FILE PATTERN N SECONDS: until FILE holds N lines matching PATTERN
  local deadline=$(($(date +%s) + $4))
  until [ "$(count "$1" "$2")" -ge "$3" ]; do
    [ "$(date +%s)" -ge "$deadline" ] && { echo "TIMEOUT waiting for $3 x '$2' in $1"; return 1; }
    sleep 0.05
  done
}

hook_time() { # EVENT N: the time of the Nth EVENT hook in $LOG/hooks.jsonl
  python3 -c "import json,sys; print([h['t'] for h in map(json.loads, open('$LOG/hooks.jsonl')) if h['event']=='$1'][$2-1])"
}

# The spike's claude: its argv names a file under $SPIKE, which no other claude on this machine does.
claude_pid() { pgrep -f "^$CLAUDE_BIN .*$SPIKE/" | head -1; }

# Every TCP socket claude holds, sampled back to back (lsof takes ~0.1 s) until it exits, to
# $LOG/sockets.txt with the number of samples that saw each. The mock's own port is the positive
# control: if it never shows, the sampler is blind.
sample_sockets() { # PID
  local samples=0
  while kill -0 "$1" 2>/dev/null; do
    lsof -a -i -n -P -p "$1" 2>/dev/null | awk 'NR>1 {print $8, $9, $10}' >>"$LOG/sockets.raw"
    samples=$((samples + 1))
  done
  { echo "samples: $samples"; sort "$LOG/sockets.raw" 2>/dev/null | uniq -c; } >"$LOG/sockets.txt"
}

type_prompt() { # TEXT: typed as keys, then Enter
  "${TMUX_CMD[@]}" send-keys -t spike -l "$1"
  "${TMUX_CMD[@]}" send-keys -t spike Enter
}

# claude in the tmux session `spike`, through launch.sh; returns once a new SessionStart hook ran
# and the input box is drawn (it appears a moment after SessionStart; keys sent before it are lost).
tui_start() { # CONFIG_DIR claude args...
  local config=$1; shift
  local seen; seen=$(count "$LOG/hooks.jsonl" SessionStart)
  "${TMUX_CMD[@]}" kill-server 2>/dev/null
  "${TMUX_CMD[@]}" new-session -d -s spike -x 120 -y 40 -e LOG="$LOG" -e TIME_OUT="${TIME_OUT:-}" \
    -e MOCK_PORT="$MOCK_PORT" -e PROXY_PORT="$PROXY_PORT" "bash $SPIKE/launch.sh $config -- $*; sleep 600"
  wait_count "$LOG/hooks.jsonl" SessionStart $((seen + 1)) 30 || return 1
  sleep 1.5
}

tui_quit() { # two Ctrl-C, as a user leaves claude
  "${TMUX_CMD[@]}" send-keys -t spike C-c
  sleep 0.3
  "${TMUX_CMD[@]}" send-keys -t spike C-c
}

peak_rss_mb() { awk '/maximum resident set size/ {printf "%.0f", $1/1048576}' "$1"; }

now() { python3 -c 'import time; print(time.time())'; }
since() { python3 -c "import time; print(round(time.time() - $1, 2))"; }

# Mock-only answer; proves the base URL routes to the mock.
c1() {
  fresh c1
  start_servers "$LOG"
  (cd work && cc "$CFG" ANTHROPIC_BASE_URL=$MOCK_URL ANTHROPIC_API_KEY=$KEY -- -p "say hi" </dev/null)
  echo "exit=$?"
  stop_servers
  python3 show.py "$LOG"
}

# Every hook event, plus an MCP tool call allowed by --allowedTools.
c23() {
  fresh c23
  start_servers "$LOG"
  load_script '[{"match":{"last_user_contains":"PINGME"},"reply":{"tool_use":{"name":"mcp__spike__ping","input":{"word":"hello"}}}},
                {"match":{"has_tool_result":true},"reply":{"text":"GOT {tool_result}"}}]'
  (cd work && cc "$CFG" ANTHROPIC_BASE_URL=$MOCK_URL ANTHROPIC_API_KEY=$KEY -- -p "PINGME please" \
    --settings "$SPIKE/hooks-settings.json" --mcp-config "$SPIKE/mcp.json" --allowedTools mcp__spike__ping </dev/null)
  echo "exit=$?"
  stop_servers
  python3 show.py "$LOG"
}

# PermissionRequest for a Bash write outside cwd, answered by the hook: none, allow, deny.
c4() {
  for answer in none allow deny; do
    fresh c4-$answer
    rm -f "$SPIKE/perm-$answer"
    case $answer in
      allow) echo '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}' >"$LOG/decision-PermissionRequest" ;;
      deny) echo '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny","message":"spike says no"}}}' >"$LOG/decision-PermissionRequest" ;;
    esac
    start_servers "$LOG"
    load_script "[{\"match\":{\"last_user_contains\":\"TOUCH\"},\"reply\":{\"tool_use\":{\"name\":\"Bash\",\"input\":{\"command\":\"touch $SPIKE/perm-$answer\",\"description\":\"touch file\"}}}},
                  {\"match\":{\"has_tool_result\":true},\"reply\":{\"text\":\"AFTER {tool_result}\"}}]"
    (cd work && cc "$CFG" ANTHROPIC_BASE_URL=$MOCK_URL ANTHROPIC_API_KEY=$KEY -- -p "TOUCH it" \
      --permission-mode default --settings "$SPIKE/hooks-settings.json" </dev/null)
    echo "== $answer: file made? $(test -e "$SPIKE/perm-$answer" && echo yes || echo no)"
    stop_servers
    python3 show.py "$LOG"
  done
}

# StopFailure on an API error that never clears, in the TUI: under -p the hook races claude's exit
# and ran in only 1 of 5 runs. Times Enter -> StopFailure; c5slow adds 500 with default retries.
c5() { stop_failure 500:api_error:0 529:overloaded_error:0 529:overloaded_error:default; }
c5slow() { stop_failure 500:api_error:default; }

stop_failure() { # CODE:TYPE:RETRIES ...
  for variant in "$@"; do
    IFS=: read -r code kind retries <<<"$variant"
    fresh "c5-$code-$retries"
    seed_config "$CFG"
    local max=
    [ "$retries" = 0 ] && max='"CLAUDE_CODE_MAX_RETRIES": "0",'
    echo "{\"env\":{$max \"ANTHROPIC_BASE_URL\":\"$MOCK_URL\",\"ANTHROPIC_API_KEY\":\"$KEY\",
      \"CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL\":\"1\"},\"permissions\":{\"defaultMode\":\"default\"}}" >"$CFG/settings.json"
    start_servers "$LOG"
    load_script "[{\"match\":{\"main\":true},\"times\":99,\"reply\":{\"error\":{\"status\":$code,\"type\":\"$kind\",\"message\":\"mock $kind\"}}}]"
    tui_start "$CFG" --settings "$SPIKE/hooks-settings.json" || return 1
    local typed; typed=$(now)
    type_prompt "hello"
    wait_count "$LOG/hooks.jsonl" StopFailure 1 300
    echo "== c5 $code, retries $retries: Enter -> StopFailure $(python3 -c "print(round($(hook_time StopFailure 1) - $typed, 2))")s," \
      "agent-loop requests $(grep -c '"n_tools": [1-9]' "$LOG/requests.jsonl")," \
      "error=$(grep StopFailure "$LOG/hooks.jsonl" | python3 -c "import json,sys; print(json.load(sys.stdin)['payload']['error'])")"
    echo "   screen: $(screen | grep -m1 'API Error' | cut -c1-100)"
    tui_quit
    "${TMUX_CMD[@]}" kill-server
    stop_servers
  done
}

# Base URL and credential from CLAUDE_CONFIG_DIR/settings.json only; no ANTHROPIC_* in the process
# environment (roundup strips them, A30). Run with a roundup-like --settings carrying its own env,
# tool search on, and an MCP call allowed by settings permissions.allow, not a flag.
c8() {
  for auth in key token helper; do
    fresh c8-$auth
    case $auth in
      key) echo "{\"env\":{\"ANTHROPIC_BASE_URL\":\"$MOCK_URL\",\"ANTHROPIC_API_KEY\":\"$KEY\"}}" >"$CFG/settings.json" ;;
      token) echo "{\"env\":{\"ANTHROPIC_BASE_URL\":\"$MOCK_URL\",\"ANTHROPIC_AUTH_TOKEN\":\"sk-mock-token-01\"}}" >"$CFG/settings.json" ;;
      helper) echo "{\"env\":{\"ANTHROPIC_BASE_URL\":\"$MOCK_URL\"},\"apiKeyHelper\":\"echo sk-mock-helper-01\"}" >"$CFG/settings.json" ;;
    esac
    start_servers "$LOG"
    load_script '[{"match":{"last_user_contains":"PINGME"},"reply":{"tool_use":{"name":"mcp__spike__ping","input":{"word":"from-settings-env"}}}},
                  {"match":{"has_tool_result":true},"reply":{"text":"GOT {tool_result}"}}]'
    (cd work && cc "$CFG" -- -p "PINGME please" \
      --settings "$SPIKE/roundup-like-settings.json" --mcp-config "$SPIKE/mcp.json" </dev/null 2>&1 | grep -v "auto mode")
    echo "== c8 $auth"
    echo "   MCP server saw ANTHROPIC_*: $(head -1 "$LOG/mcp.jsonl")"
    stop_servers
    python3 show.py "$LOG"
  done
}

# The interactive TUI in tmux, configured only through CLAUDE_CONFIG_DIR (the product route): typed
# prompt -> MCP call -> reply on screen; a bracketed paste; a PermissionRequest answered by its hook
# and one answered by a keystroke; then --resume of the same conversation (c7). Also times start-up
# (c9).
c67() {
  fresh c67
  seed_config "$CFG"
  cat >"$CFG/settings.json" <<JSON
{"env": {"ANTHROPIC_BASE_URL": "$MOCK_URL", "ANTHROPIC_API_KEY": "$KEY", "CLAUDE_CODE_MAX_RETRIES": "0",
         "CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL": "1"},
 "permissions": {"defaultMode": "default"}}
JSON
  rm -f "$SPIKE/perm-c67-hook" "$SPIKE/perm-c67-key"
  start_servers "$LOG"
  load_script "[{\"match\":{\"last_user_contains\":\"PINGME\"},\"reply\":{\"tool_use\":{\"name\":\"mcp__spike__ping\",\"input\":{\"word\":\"tui\"}}}},
                {\"match\":{\"last_user_contains\":\"PASTE3\"},\"reply\":{\"text\":\"PASTE-REPLY-5d1e\"}},
                {\"match\":{\"last_user_contains\":\"TOUCH-HOOK\"},\"reply\":{\"tool_use\":{\"name\":\"Bash\",\"input\":{\"command\":\"touch $SPIKE/perm-c67-hook\",\"description\":\"touch outside\"}}}},
                {\"match\":{\"last_user_contains\":\"TOUCH-KEY\"},\"reply\":{\"tool_use\":{\"name\":\"Bash\",\"input\":{\"command\":\"touch $SPIKE/perm-c67-key\",\"description\":\"touch outside\"}}}},
                {\"match\":{\"last_user_contains\":\"AFTER-RESUME\"},\"reply\":{\"text\":\"RESUME-REPLY-c0de\"}},
                {\"match\":{\"has_tool_result\":true},\"times\":99,\"reply\":{\"text\":\"GOT {tool_result}\"}}]"
  local argv="--settings $SPIKE/roundup-like-settings.json --mcp-config $SPIKE/mcp.json"
  local start; start=$(now)
  TIME_OUT="$LOG/time-start.txt" tui_start "$CFG" "$argv" || return 1
  echo "c9 launch -> SessionStart hook: $(python3 -c "print(round($(hook_time SessionStart 1) - $start, 2))")s"
  local typed; typed=$(now)
  type_prompt "PINGME from the TUI"
  wait_count "$LOG/hooks.jsonl" '"Stop"' 1 30
  echo "c9 Enter -> Stop hook (MCP round trip): $(python3 -c "print(round($(hook_time Stop 1) - $typed, 2))")s"
  sleep 0.3
  echo "c6 reply on screen: $(screen | grep -c 'GOT PONG-91c2 tui') line(s)"
  echo "c9 claude RSS while idle: $(($(ps -o rss= -p "$(claude_pid)") / 1024)) MB"

  "${TMUX_CMD[@]}" set-buffer -b p "$(printf 'paste line one\npaste line two\nPASTE3 end')"
  "${TMUX_CMD[@]}" paste-buffer -p -d -b p -t spike
  sleep 0.3
  "${TMUX_CMD[@]}" send-keys -t spike Enter
  wait_count "$LOG/hooks.jsonl" '"Stop"' 2 30
  echo "c6 pasted prompt as one UserPromptSubmit: $(python3 -c "import json; print([repr(h['payload']['prompt']) for h in map(json.loads, open('$LOG/hooks.jsonl')) if h['event']=='UserPromptSubmit'][-1])")"

  echo '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}' >"$LOG/decision-PermissionRequest"
  type_prompt "TOUCH-HOOK please"
  wait_count "$LOG/hooks.jsonl" '"Stop"' 3 60
  echo "c6 PermissionRequest allowed by hook: file made? $(test -e "$SPIKE/perm-c67-hook" && echo yes || echo no)"
  rm -f "$LOG/decision-PermissionRequest"
  type_prompt "TOUCH-KEY please"
  wait_count "$LOG/hooks.jsonl" PermissionRequest 2 30
  sleep 0.5
  echo "c6 dialog shown: $(screen | grep -c 'Do you want to proceed')"
  "${TMUX_CMD[@]}" send-keys -t spike 1
  wait_count "$LOG/hooks.jsonl" '"Stop"' 4 30
  echo "c6 PermissionRequest answered by keystroke 1: file made? $(test -e "$SPIKE/perm-c67-key" && echo yes || echo no)"

  local session; session=$(python3 -c "import json; print(json.loads(open('$LOG/hooks.jsonl').readline())['payload']['session_id'])")
  tui_quit
  wait_for "$LOG/hooks.jsonl" SessionEnd 15
  wait_for "$LOG/time-start.txt" 'maximum resident' 15
  echo "c9 first run: $(head -1 "$LOG/time-start.txt" | awk '{print $1}')s wall, peak RSS $(peak_rss_mb "$LOG/time-start.txt") MB"
  "${TMUX_CMD[@]}" kill-session -t spike

  # c7: resume the conversation in a new process.
  TIME_OUT="$LOG/time-resume.txt" tui_start "$CFG" "$argv --resume $session" || return 1
  echo "c7 SessionStart on resume: $(tail -1 "$LOG/hooks.jsonl" | python3 -c "import json,sys; p=json.load(sys.stdin)['payload']; print(p['source'], p['session_id'] == '$session' and 'same id' or 'NEW id')")"
  type_prompt "AFTER-RESUME question"
  wait_count "$LOG/hooks.jsonl" '"Stop"' 5 30
  echo "c7 user turns the mock received after resume: $(tail -1 "$LOG/requests.jsonl" | python3 -c "import json,sys; print(json.load(sys.stdin)['user_texts'])" | cut -c1-400)"
  echo "c7 reply on screen: $(screen | grep -c 'RESUME-REPLY-c0de') line(s)"
  tui_quit
  wait_for "$LOG/time-resume.txt" 'maximum resident' 15
  "${TMUX_CMD[@]}" kill-server
  stop_servers
  python3 show.py "$LOG"
}

# Cost of one -p run with an MCP round trip, against the fake claude's start-up.
c9() {
  fresh c9
  echo "{\"env\":{\"ANTHROPIC_BASE_URL\":\"$MOCK_URL\",\"ANTHROPIC_API_KEY\":\"$KEY\"}}" >"$CFG/settings.json"
  start_servers "$LOG"
  for run in 1 2 3; do
    load_script '[{"match":{"last_user_contains":"PINGME"},"reply":{"tool_use":{"name":"mcp__spike__ping","input":{"word":"cost"}}}},
                  {"match":{"has_tool_result":true},"reply":{"text":"GOT {tool_result}"}}]'
    : >"$LOG/hooks.jsonl"
    local start; start=$(now)
    (cd work && TIME_OUT="$LOG/time-p$run.txt" cc "$CFG" -- -p "PINGME" --settings "$SPIKE/roundup-like-settings.json" \
      --mcp-config "$SPIKE/mcp.json" </dev/null >/dev/null 2>&1)
    echo "c9 -p run $run: SessionStart after $(python3 -c "print(round($(hook_time SessionStart 1) - $start, 2))")s," \
      "Stop after $(python3 -c "print(round($(hook_time Stop 1) - $start, 2))")s," \
      "exit after $(head -1 "$LOG/time-p$run.txt" | awk '{print $1}')s, peak RSS $(peak_rss_mb "$LOG/time-p$run.txt") MB"
  done
  stop_servers
  # The fake: SessionStart played from a recorded payload, then it sleeps; killed once the hook ran.
  echo '{"payload": {"hook_event_name": "SessionStart", "source": "startup", "session_id": "x"}}' >"$LOG/payloads.jsonl"
  for run in 1 2 3; do
    : >"$LOG/hooks.jsonl"
    local start; start=$(now)
    (cd work && SPIKE_LOG="$LOG" FAKE_CLAUDE_PAYLOADS="$LOG/payloads.jsonl" FAKE_CLAUDE_EVENTS=SessionStart \
      exec python3 "$SPIKE/fake_claude_copy.py" --settings "$SPIKE/hooks-settings.json" </dev/null >/dev/null 2>&1) &
    local fake=$!
    wait_for "$LOG/hooks.jsonl" SessionStart 10
    echo "c9 fake run $run: SessionStart after $(python3 -c "print(round($(hook_time SessionStart 1) - $start, 2))")s," \
      "RSS $(($(ps -o rss= -p $fake) / 1024)) MB"
    kill $fake
    wait $fake 2>/dev/null
  done
}

# Traffic that is not to the mock. The refusing proxy catches every connection that honours
# HTTPS_PROXY and never lets it leave the machine; the socket sampler catches the rest while it
# runs. The mock answers after 1.5 s, so the sampler must see the mock's socket (positive control).
#   default:  no DISABLE_* switch anywhere
#   settings: the switches only in CLAUDE_CODE_DIR/settings.json env, as a product launch would
c10() {
  for where in default settings; do
    fresh c10-$where
    local switches=
    [ $where = settings ] && switches='"CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1", "DISABLE_AUTOUPDATER": "1",'
    echo "{\"env\":{$switches \"ANTHROPIC_BASE_URL\":\"$MOCK_URL\",\"ANTHROPIC_API_KEY\":\"$KEY\"}}" >"$CFG/settings.json"
    start_servers "$LOG"
    load_script '[{"match":{"last_user_contains":"PINGME"},"reply":{"delay_ms":1500,"tool_use":{"name":"mcp__spike__ping","input":{"word":"traffic"}}}},
                  {"match":{"has_tool_result":true},"reply":{"delay_ms":1500,"text":"GOT {tool_result}"}}]'
    (cd work && NO_SWITCHES=1 cc "$CFG" -- -p "PINGME" --settings "$SPIKE/roundup-like-settings.json" \
      --mcp-config "$SPIKE/mcp.json" </dev/null 2>&1 | grep -v "auto mode") &
    local run=$!
    local pid="" tries=0
    until [ -n "$pid" ] || [ $tries -ge 500 ]; do pid=$(claude_pid); tries=$((tries + 1)); sleep 0.02; done
    [ -n "$pid" ] && sample_sockets "$pid"
    wait $run
    echo "== c10 switches $where: sockets claude held (count of samples that saw each):"
    sed 's/^/    /' "$LOG/sockets.txt"
    echo "   proxy caught: $(cut -c1-300 "$LOG/proxy.jsonl" 2>/dev/null | python3 -c "import json,sys; print(sorted({json.loads(l)['request'] for l in sys.stdin}))")"
    stop_servers
  done
}

# The argv roundup builds (crates/agents/src/claude_code/launch.rs): --append-system-prompt-file,
# --tools for a Door, --model and --effort. Shows what reaches the API.
c11() {
  fresh c11
  echo "{\"env\":{\"ANTHROPIC_BASE_URL\":\"$MOCK_URL\",\"ANTHROPIC_API_KEY\":\"$KEY\"}}" >"$CFG/settings.json"
  echo "You are a spike Agent. MARK-b71e" >"$LOG/brief.md"
  start_servers "$LOG"
  for door in no yes; do
    local tools=()
    [ $door = yes ] && tools=(--tools "Read,Grep,Glob,ToolSearch")
    (cd work && cc "$CFG" -- -p "hello" --settings "$SPIKE/roundup-like-settings.json" --mcp-config "$SPIKE/mcp.json" \
      --append-system-prompt-file "$LOG/brief.md" ${tools[@]+"${tools[@]}"} --model claude-sonnet-5-5 --effort low \
      </dev/null 2>&1 | grep -v "auto mode")
    echo "== c11 door=$door:"
    tail -1 "$LOG/requests.jsonl" | python3 -c "
import json, sys
r = json.load(sys.stdin)
print('   model:', r['model'], '| brief mark in system:', r['marks_in_system'], '| anywhere:', r['marks_anywhere'])
print('   tools:', r['tool_names'])
print('   output_config:', r['output_config'], '| thinking:', r['thinking'])"
  done
  stop_servers
}

# Hazards a test suite must guard against.
#   auto:        no defaultMode and no allow rule: claude's default `auto` mode sends an unallowed
#                tool to a classifier on another model; the mock's reply is no verdict, so the tool
#                is blocked and no PermissionRequest fires
#   race:        under -p, StopFailure's hook races claude's exit; five runs
#   marketplace: the TUI fetches the official plugin marketplace unless one of two settings stops it
c12() {
  fresh c12-auto
  echo "{\"env\":{\"ANTHROPIC_BASE_URL\":\"$MOCK_URL\",\"ANTHROPIC_API_KEY\":\"$KEY\"}}" >"$CFG/settings.json"
  start_servers "$LOG"
  load_script '[{"match":{"last_user_contains":"PINGME"},"reply":{"tool_use":{"name":"mcp__spike__ping","input":{"word":"auto"}}}},
                {"match":{"has_tool_result":true},"reply":{"text":"GOT {tool_result}"}}]'
  (cd work && cc "$CFG" -- -p "PINGME" --settings "$SPIKE/hooks-settings.json" --mcp-config "$SPIKE/mcp.json" \
    </dev/null 2>&1 | grep -v "auto mode" | cut -c1-120)
  stop_servers
  echo "== c12 auto: permission_mode $(python3 -c "import json; print(sorted(set(h['payload'].get('permission_mode', '') for h in map(json.loads, open('$LOG/hooks.jsonl'))) - set([''])))")," \
    "PermissionRequest hooks $(count "$LOG/hooks.jsonl" PermissionRequest)," \
    "MCP calls $(count "$LOG/mcp.jsonl" tools/call)"
  echo "   side calls: $(python3 -c "
import json, collections
side = [r for r in map(json.loads, open('$LOG/requests.jsonl')) if r.get('n_tools') == 0]
print(dict(collections.Counter((r['model'], 'stream' if r['stream'] else 'no stream') for r in side)))")"

  local fired=0
  for run in 1 2 3 4 5; do
    fresh c12-race-$run
    echo "{\"env\":{\"ANTHROPIC_BASE_URL\":\"$MOCK_URL\",\"ANTHROPIC_API_KEY\":\"$KEY\",\"CLAUDE_CODE_MAX_RETRIES\":\"0\"}}" >"$CFG/settings.json"
    start_servers "$LOG"
    load_script '[{"match":{"main":true},"times":99,"reply":{"error":{"status":500,"type":"api_error","message":"mock"}}}]'
    (cd work && cc "$CFG" -- -p "hello" --settings "$SPIKE/hooks-settings.json" </dev/null >/dev/null 2>&1)
    sleep 1
    stop_servers
    [ "$(count "$LOG/hooks.jsonl" StopFailure)" -gt 0 ] && fired=$((fired + 1))
  done
  echo "== c12 race: StopFailure hook ran in $fired of 5 -p runs"

  for stop in none key env; do
    fresh c12-marketplace-$stop
    seed_config "$CFG"
    [ $stop = key ] && python3 -c "
import json; p = '$CFG/.claude.json'; c = json.load(open(p)); c['officialMarketplaceAutoInstallAttempted'] = True; json.dump(c, open(p, 'w'))"
    local extra=
    [ $stop = env ] && extra='"CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL": "1",'
    echo "{\"env\":{$extra \"ANTHROPIC_BASE_URL\":\"$MOCK_URL\",\"ANTHROPIC_API_KEY\":\"$KEY\"},\"permissions\":{\"defaultMode\":\"default\"}}" >"$CFG/settings.json"
    start_servers "$LOG"
    tui_start "$CFG" --settings "$SPIKE/hooks-settings.json" || return 1
    type_prompt "hello"
    wait_count "$LOG/hooks.jsonl" '"Stop"' 1 30
    sleep 2
    tui_quit
    "${TMUX_CMD[@]}" kill-server
    stop_servers
    echo "== c12 marketplace, stopped by $stop: proxy caught $(cut -c1-300 "$LOG/proxy.jsonl" 2>/dev/null | python3 -c "import json,sys; print(sorted({json.loads(l)['request'] for l in sys.stdin}))")"
  done
}

[ $# -eq 0 ] && set -- c1 c23 c4 c5 c8 c67 c9 c10 c11 c12
for check in "$@"; do
  echo "######## $check"
  "$check"
done
