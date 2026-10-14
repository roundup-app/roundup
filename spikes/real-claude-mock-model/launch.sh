#!/usr/bin/env bash
# Starts the real claude through env.sh's clean launcher; for tmux, which runs one command.
#   LOG=... bash launch.sh CONFIG_DIR [NAME=VALUE ...] -- claude args...
source /tmp/fake-claude-research/spike/env.sh
cd /tmp/fake-claude-research/spike/work
cc "$@"
