# Sourced by run.sh. Shared paths, servers and a clean-environment launcher for the real claude.
SPIKE=/tmp/fake-claude-research/spike
CLAUDE_BIN=/Users/saad.shahd/.local/bin/claude
MOCK_PORT=${MOCK_PORT:-18431}
PROXY_PORT=${PROXY_PORT:-18432}
MOCK_URL=http://127.0.0.1:$MOCK_PORT
KEY=sk-mock-key-000000000000000000000001

start_servers() { # LOG_DIR
  mkdir -p "$1"
  python3 -I "$SPIKE/mock.py" $MOCK_PORT "$1" &
  MOCK_PID=$!
  python3 -I "$SPIKE/proxy.py" $PROXY_PORT "$1" &
  PROXY_PID=$!
  for _ in $(seq 50); do curl -s -o /dev/null "$MOCK_URL/ready" && break; sleep 0.1; done
}

# The servers end on SIGTERM, which `wait` reports as 143; that is the expected end.
stop_servers() { kill $MOCK_PID $PROXY_PID 2>/dev/null; wait $MOCK_PID $PROXY_PID 2>/dev/null || true; }

load_script() { # JSON array of entries
  curl -s -X POST "$MOCK_URL/__load" -d "{\"script\": $1}" >/dev/null
}

# TIME_OUT=<file> wraps claude in /usr/bin/time -l (wall time and peak RSS).
# Run claude with only these variables: no ANTHROPIC_* unless passed as extra NAME=VALUE args
# before `--`. Every outbound connection that is not to 127.0.0.1 goes to the refusing proxy.
# NO_SWITCHES=1 drops the DISABLE_* variables from the process environment; the proxy stays.
cc() { # CONFIG_DIR [NAME=VALUE ...] -- claude args...
  local config=$1; shift
  local extra=()
  while [ "$1" != "--" ]; do extra+=("$1"); shift; done
  shift
  local switches=(CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 DISABLE_AUTOUPDATER=1)
  [ -n "${NO_SWITCHES:-}" ] && switches=()
  local proxy=(HTTPS_PROXY=http://127.0.0.1:$PROXY_PORT HTTP_PROXY=http://127.0.0.1:$PROXY_PORT
    https_proxy=http://127.0.0.1:$PROXY_PORT http_proxy=http://127.0.0.1:$PROXY_PORT
    NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost)
  env -i HOME="$HOME" USER="$USER" PATH="/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin" \
    TERM=xterm-256color LANG=en_US.UTF-8 SHELL=/bin/zsh TMPDIR="${TMPDIR:-/tmp}" \
    CLAUDE_CONFIG_DIR="$config" SPIKE_LOG="$LOG" \
    ${switches[@]+"${switches[@]}"} "${proxy[@]}" ${extra[@]+"${extra[@]}"} \
    ${TIME_OUT:+/usr/bin/time -l -o "$TIME_OUT"} "$CLAUDE_BIN" "$@"
}
